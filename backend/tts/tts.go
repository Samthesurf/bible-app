// Package tts is a Go port of the Electron TTS engines:
//
//	electron/tts-stub.ts   -> StubEngine
//	electron/tts-kokoro.ts -> OpenRouterEngine (OpenRouter Kokoro-82M)
//	electron/tts-local.ts  -> LocalEngine (persistent Kokoro-onnx service)
//	electron/tts-hybrid.ts -> HybridEngine (OpenRouter live + local cache)
//
// Playback strategy is identical to the Electron app: the hybrid engine
// plays each verse live via OpenRouter while a local Kokoro-onnx model
// synthesizes the same verse into a persistent cache in the background.
// Repeat readings play from the free, instant local cache.
package tts

import (
	"bufio"
	"bytes"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	openRouterTTSURL = "https://openrouter.ai/api/v1/audio/speech"
	defaultModel     = "hexgrad/kokoro-82m"
	DefaultVoice     = "af_heart"
	DefaultSpeed     = 1.0

	maxRetries      = 4
	retryBaseMs     = 500
	requestTimeout  = 30 * time.Second
	prefetchMax     = 6
	synthTimeout    = 120 * time.Second
	serviceStartWait = 1500 * time.Millisecond
)

// ErrStopped reports an intentional stop (playback killed), not a failure.
var ErrStopped = errors.New("TTS_STOPPED")

// State mirrors the TTSState union in src/types/tts.ts.
type State struct {
	Status  string `json:"status"`
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

// IdleState is the resting state.
func IdleState() State { return State{Status: "idle"} }

// SpeakingState marks live playback of text.
func SpeakingState(text string) State { return State{Status: "speaking", Text: text} }

// ErrorState carries a failure message.
func ErrorState(message string) State { return State{Status: "error", Message: message} }

// UnavailableState marks a missing engine configuration.
func UnavailableState(message string) State { return State{Status: "unavailable", Message: message} }

// Engine is the TTSEngine contract (see electron/tts-stub.ts).
type Engine interface {
	IsAvailable() bool
	Speak(text string) error
	Prefetch(text string) error
	Stop() error
	UpdateConfig(voice string, speed float64)
	OnStateChange(func(State))
	Stats() (cached int, lastSource string)
	Cleanup()
}

// ResolveAPIKey reads the OpenRouter key: env var first, then
// ~/.hermes/.env (same order as Electron's resolveOpenRouterKey).
func ResolveAPIKey() string {
	if k := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")); k != "" {
		return k
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(home, ".hermes", ".env"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "OPENROUTER_API_KEY=") {
			continue
		}
		val := strings.TrimSpace(strings.TrimPrefix(line, "OPENROUTER_API_KEY="))
		if val == "" || strings.HasPrefix(val, "#") {
			continue
		}
		return val
	}
	return ""
}

// player tracks one mpv playback process so Stop can kill it.
type player struct {
	mu  sync.Mutex
	cmd *exec.Cmd
}

func (p *player) kill() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Signal(syscall.SIGTERM)
	}
}

func (p *player) play(filePath string) error {
	cmd := exec.Command("mpv", "--no-video", "--really-quiet", filePath)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("audio player error: %w. Is mpv installed?", err)
	}
	p.mu.Lock()
	p.cmd = cmd
	p.mu.Unlock()
	err := cmd.Wait()
	p.mu.Lock()
	if p.cmd == cmd {
		p.cmd = nil
	}
	p.mu.Unlock()
	if err != nil {
		return ErrStopped
	}
	return nil
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

// StubEngine reports unavailable until a real engine is configured.
type StubEngine struct {
	mu       sync.Mutex
	listener func(State)
}

// NewStub creates the placeholder engine.
func NewStub() *StubEngine { return &StubEngine{} }

func (s *StubEngine) IsAvailable() bool { return false }

func (s *StubEngine) Speak(_ string) error {
	return errors.New("TTS engine not configured")
}

func (s *StubEngine) Prefetch(_ string) error { return nil }

func (s *StubEngine) Stop() error { return nil }

func (s *StubEngine) UpdateConfig(_ string, _ float64) {}

func (s *StubEngine) OnStateChange(l func(State)) {
	s.mu.Lock()
	s.listener = l
	s.mu.Unlock()
	l(UnavailableState("No TTS engine configured"))
}

func (s *StubEngine) Stats() (int, string) { return 0, "none" }

func (s *StubEngine) Cleanup() {}

// ---------------------------------------------------------------------------
// OpenRouter Kokoro (live network engine)
// ---------------------------------------------------------------------------

// OpenRouterEngine synthesizes via OpenRouter's Kokoro-82M and plays the
// result headlessly with mpv. Mirrors electron/tts-kokoro.ts, including the
// sliding prefetch window and retry policy.
type OpenRouterEngine struct {
	apiKey string

	mu    sync.Mutex
	voice string
	speed float64

	play player

	tempDir string

	cacheMu   sync.Mutex
	preCache  map[string]string
	cacheOrd  []string
	inflight  map[string]chan struct{}

	listenerMu sync.Mutex
	listener   func(State)
}

// NewOpenRouter creates the network TTS engine.
func NewOpenRouter(apiKey string) *OpenRouterEngine {
	return &OpenRouterEngine{
		apiKey:   apiKey,
		voice:    DefaultVoice,
		speed:    DefaultSpeed,
		tempDir:  filepath.Join(os.TempDir(), "bible-app-tts"),
		preCache: make(map[string]string),
		inflight: make(map[string]chan struct{}),
	}
}

func (e *OpenRouterEngine) IsAvailable() bool {
	return len(e.apiKey) > 10
}

func hashPrefetchKey(voice string, speed float64, text string) string {
	return fmt.Sprintf("%s|%v|%s", voice, speed, text)
}

func (e *OpenRouterEngine) emit(s State) {
	e.listenerMu.Lock()
	l := e.listener
	e.listenerMu.Unlock()
	if l != nil {
		l(s)
	}
}

// Speak plays text, reusing a prefetched file when one exists.
func (e *OpenRouterEngine) Speak(text string) error {
	if !e.IsAvailable() {
		return errors.New("TTS engine not configured: missing API key")
	}
	if err := e.Stop(); err != nil {
		return err
	}
	e.mu.Lock()
	voice, speed := e.voice, e.speed
	e.mu.Unlock()

	e.emit(SpeakingState(text))
	key := hashPrefetchKey(voice, speed, text)

	e.cacheMu.Lock()
	tempFile, ok := e.preCache[key]
	if ok {
		delete(e.preCache, key)
		for i, k := range e.cacheOrd {
			if k == key {
				e.cacheOrd = append(e.cacheOrd[:i], e.cacheOrd[i+1:]...)
				break
			}
		}
	}
	inflight, waiting := e.inflight[key]
	e.cacheMu.Unlock()

	if !ok && waiting {
		select {
		case <-inflight:
		case <-time.After(2 * time.Second):
		}
		e.cacheMu.Lock()
		tempFile, ok = e.preCache[key]
		if ok {
			delete(e.preCache, key)
			for i, k := range e.cacheOrd {
				if k == key {
					e.cacheOrd = append(e.cacheOrd[:i], e.cacheOrd[i+1:]...)
					break
				}
			}
		}
		e.cacheMu.Unlock()
	}
	if !ok {
		audio, err := e.callAPI(text, voice, speed)
		if err != nil {
			e.emit(ErrorState(err.Error()))
			return err
		}
		if err := os.MkdirAll(e.tempDir, 0o755); err != nil {
			e.emit(ErrorState(err.Error()))
			return err
		}
		tempFile = filepath.Join(e.tempDir, fmt.Sprintf("tts-%d-%s.mp3", time.Now().UnixNano(), randHex(4)))
		if err := os.WriteFile(tempFile, audio, 0o644); err != nil {
			e.emit(ErrorState(err.Error()))
			return err
		}
	}
	if err := e.play.play(tempFile); err != nil {
		_ = os.Remove(tempFile)
		if errors.Is(err, ErrStopped) {
			e.emit(IdleState())
			return nil
		}
		e.emit(ErrorState(err.Error()))
		return err
	}
	_ = os.Remove(tempFile)
	e.emit(IdleState())
	return nil
}

// Prefetch fetches audio ahead of time into the sliding cache. Every call
// starts its fetch immediately and in parallel; failures are best-effort.
func (e *OpenRouterEngine) Prefetch(text string) error {
	if !e.IsAvailable() {
		return nil
	}
	e.mu.Lock()
	voice, speed := e.voice, e.speed
	e.mu.Unlock()
	key := hashPrefetchKey(voice, speed, text)

	e.cacheMu.Lock()
	if _, ok := e.preCache[key]; ok {
		e.cacheMu.Unlock()
		return nil
	}
	if _, ok := e.inflight[key]; ok {
		e.cacheMu.Unlock()
		return nil
	}
	done := make(chan struct{})
	e.inflight[key] = done
	e.cacheMu.Unlock()

	go func() {
		defer func() {
			e.cacheMu.Lock()
			delete(e.inflight, key)
			close(done)
			e.cacheMu.Unlock()
		}()
		audio, err := e.callAPI(text, voice, speed)
		if err != nil {
			return
		}
		if err := os.MkdirAll(e.tempDir, 0o755); err != nil {
			return
		}
		tmp := filepath.Join(e.tempDir, fmt.Sprintf("pre-%d-%s.mp3", time.Now().UnixNano(), randHex(4)))
		if err := os.WriteFile(tmp, audio, 0o644); err != nil {
			return
		}
		e.cacheMu.Lock()
		for len(e.preCache) >= prefetchMax && len(e.cacheOrd) > 0 {
			oldest := e.cacheOrd[0]
			e.cacheOrd = e.cacheOrd[1:]
			if p, ok := e.preCache[oldest]; ok {
				delete(e.preCache, oldest)
				_ = os.Remove(p)
			}
		}
		e.preCache[key] = tmp
		e.cacheOrd = append(e.cacheOrd, key)
		e.cacheMu.Unlock()
	}()
	return nil
}

// Stop kills live playback. The prefetch cache is intentionally kept (speak
// calls stop on entry; clearing would destroy prefetched audio).
func (e *OpenRouterEngine) Stop() error {
	e.play.kill()
	e.emit(IdleState())
	return nil
}

func (e *OpenRouterEngine) OnStateChange(l func(State)) {
	e.listenerMu.Lock()
	e.listener = l
	e.listenerMu.Unlock()
}

// UpdateConfig sets the runtime voice/speed. Empty voice or non-positive
// speed means "keep the current value".
func (e *OpenRouterEngine) UpdateConfig(voice string, speed float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if voice != "" {
		e.voice = voice
	}
	if speed > 0 {
		e.speed = speed
	}
}

func (e *OpenRouterEngine) Stats() (int, string) { return 0, "none" }

// Cleanup clears prefetched audio and temp files (called on app quit).
func (e *OpenRouterEngine) Cleanup() {
	e.cacheMu.Lock()
	for _, p := range e.preCache {
		_ = os.Remove(p)
	}
	e.preCache = make(map[string]string)
	e.cacheOrd = nil
	e.cacheMu.Unlock()
	_ = os.RemoveAll(e.tempDir)
}

type httpStatusError struct {
	status int
	msg    string
}

func (e *httpStatusError) Error() string { return e.msg }

func (e *OpenRouterEngine) callAPI(text, voice string, speed float64) ([]byte, error) {
	var last error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(backoffMs(attempt))
		}
		buf, retryable, err := e.callAPISingle(text, voice, speed)
		if err == nil {
			return buf, nil
		}
		last = err
		if !retryable || attempt == maxRetries {
			return nil, err
		}
	}
	if last == nil {
		last = errors.New("TTS request failed")
	}
	return nil, last
}

func (e *OpenRouterEngine) callAPISingle(text, voice string, speed float64) ([]byte, bool, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":           defaultModel,
		"input":           text,
		"voice":           voice,
		"response_format": "mp3",
		"speed":           speed,
	})
	req, err := http.NewRequest(http.MethodPost, openRouterTTSURL, bytes.NewReader(body))
	if err != nil {
		return nil, true, err
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("HTTP-Referer", "https://github.com/Samthesurf/bible-app")
	req.Header.Set("X-Title", "Bible App TTS")

	client := &http.Client{Timeout: requestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, true, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		err := &httpStatusError{
			status: resp.StatusCode,
			msg:    fmt.Sprintf("OpenRouter TTS API error %d: %s", resp.StatusCode, strings.TrimSpace(string(raw))),
		}
		retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		return nil, retryable, err
	}
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, true, err
	}
	return buf, false, nil
}

func backoffMs(attempt int) time.Duration {
	base := float64(retryBaseMs) * float64(int64(1)<<(attempt-1))
	jitter := 0.8 + rand.Float64()*0.4
	return time.Duration(base * jitter * float64(time.Millisecond))
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	out := make([]byte, 0, n*2)
	for _, c := range b {
		out = append(out, "0123456789abcdef"[c>>4], "0123456789abcdef"[c&15])
	}
	return string(out)
}

// ---------------------------------------------------------------------------
// Local Kokoro-onnx (offline engine)
// ---------------------------------------------------------------------------

// LocalEngine spawns the persistent Python Kokoro service once and
// synthesizes WAV on demand. Mirrors electron/tts-local.ts.
type LocalEngine struct {
	mu    sync.Mutex
	voice string
	speed float64

	play player

	servicePath string
	pythonPath  string
	cacheDir    string

	availMu   sync.Mutex
	availSet  bool
	avail     bool

	svcMu   sync.Mutex
	svc     *exec.Cmd
	stdin   io.WriteCloser
	pending []chan synthResult

	listenerMu sync.Mutex
	listener   func(State)
}

type synthResult struct {
	path string
	err  error
}

// NewLocal creates the offline engine with explicit paths.
func NewLocal(servicePath, pythonPath string) *LocalEngine {
	cacheBase := os.Getenv("XDG_CACHE_HOME")
	if cacheBase == "" {
		home, _ := os.UserHomeDir()
		cacheBase = filepath.Join(home, ".cache")
	}
	return &LocalEngine{
		voice:       DefaultVoice,
		speed:       DefaultSpeed,
		servicePath: servicePath,
		pythonPath:  pythonPath,
		cacheDir:    filepath.Join(cacheBase, "bible-app-kokoro", "cache"),
	}
}

func (e *LocalEngine) emit(s State) {
	e.listenerMu.Lock()
	l := e.listener
	e.listenerMu.Unlock()
	if l != nil {
		l(s)
	}
}

// HasPrerequisites reports whether the venv python and service script exist.
func (e *LocalEngine) HasPrerequisites() bool {
	if _, err := os.Stat(e.pythonPath); err != nil {
		return false
	}
	if _, err := os.Stat(e.servicePath); err != nil {
		return false
	}
	return true
}

func (e *LocalEngine) IsAvailable() bool {
	e.availMu.Lock()
	defer e.availMu.Unlock()
	if e.availSet {
		return e.avail
	}
	e.avail = false
	if !e.HasPrerequisites() {
		e.availSet = true
		return false
	}
	if err := e.startServiceLocked(); err != nil {
		e.availSet = true
		return false
	}
	e.avail = true
	e.availSet = true
	return true
}

func (e *LocalEngine) startServiceLocked() error {
	e.svcMu.Lock()
	defer e.svcMu.Unlock()
	if e.svc != nil && e.svc.Process != nil {
		return nil
	}
	env := os.Environ()
	clean := make([]string, 0, len(env))
	for _, kv := range env {
		if strings.HasPrefix(kv, "PYTHONPATH=") ||
			strings.HasPrefix(kv, "VIRTUAL_ENV=") ||
			strings.HasPrefix(kv, "PYTHONHOME=") ||
			strings.HasPrefix(kv, "PYTHONSTARTUP=") {
			continue
		}
		clean = append(clean, kv)
	}
	cmd := exec.Command(e.pythonPath, "-u", "-E", e.servicePath)
	cmd.Env = clean
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	e.svc = cmd
	e.stdin = stdin
	go e.readLoop(stdout, cmd)
	time.Sleep(serviceStartWait)
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		e.svc = nil
		return errors.New("local Kokoro service exited during startup")
	}
	return nil
}

func (e *LocalEngine) readLoop(stdout io.Reader, cmd *exec.Cmd) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		e.svcMu.Lock()
		var waiter chan synthResult
		if len(e.pending) > 0 {
			waiter = e.pending[0]
			e.pending = e.pending[1:]
		}
		e.svcMu.Unlock()
		if waiter == nil {
			continue
		}
		var msg struct {
			OK    bool   `json:"ok"`
			Path  string `json:"path"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			waiter <- synthResult{err: errors.New("malformed response from local Kokoro service")}
			continue
		}
		if msg.OK {
			waiter <- synthResult{path: msg.Path}
		} else {
			if msg.Error == "" {
				msg.Error = "Local Kokoro generation failed"
			}
			waiter <- synthResult{err: errors.New(msg.Error)}
		}
	}
	// Service died: fail everything still queued.
	e.svcMu.Lock()
	pending := e.pending
	e.pending = nil
	if e.svc == cmd {
		e.svc = nil
	}
	e.svcMu.Unlock()
	for _, w := range pending {
		w <- synthResult{err: errors.New("local Kokoro service exited")}
	}
	e.availMu.Lock()
	e.availSet = false
	e.availMu.Unlock()
}

func (e *LocalEngine) synth(text, voice string, speed float64) (string, error) {
	e.svcMu.Lock()
	running := e.svc != nil && e.svc.Process != nil
	stdin := e.stdin
	e.svcMu.Unlock()
	if !running || stdin == nil {
		// Try (re)starting once, mirroring isAvailable hoisting.
		e.availMu.Lock()
		e.availSet = false
		e.availMu.Unlock()
		if !e.IsAvailable() {
			return "", errors.New("local Kokoro service not running")
		}
		e.svcMu.Lock()
		stdin = e.stdin
		e.svcMu.Unlock()
		if stdin == nil {
			return "", errors.New("local Kokoro service not running")
		}
	}
	waiter := make(chan synthResult, 1)
	e.svcMu.Lock()
	e.pending = append(e.pending, waiter)
	e.svcMu.Unlock()
	payload, _ := json.Marshal(map[string]interface{}{"text": text, "voice": voice, "speed": speed})
	if _, err := io.WriteString(stdin, string(payload)+"\n"); err != nil {
		return "", err
	}
	select {
	case res := <-waiter:
		return res.path, res.err
	case <-time.After(synthTimeout):
		return "", errors.New("local Kokoro synthesis timed out")
	}
}

func hashCacheKey(voice string, speed float64, text string) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%v|%s", voice, speed, text)))
	out := make([]byte, 0, len(sum)*2)
	for _, c := range sum {
		out = append(out, "0123456789abcdef"[c>>4], "0123456789abcdef"[c&15])
	}
	return string(out)
}

// GetCachedPath returns the persistent cache WAV when present and valid.
func (e *LocalEngine) GetCachedPath(text, voice string, speed float64) string {
	p := filepath.Join(e.cacheDir, hashCacheKey(voice, speed, text)+".wav")
	fi, err := os.Stat(p)
	if err != nil || fi.Size() <= 1000 {
		return ""
	}
	return p
}

// IsCached reports whether text is already in the persistent cache.
func (e *LocalEngine) IsCached(text, voice string, speed float64) bool {
	return e.GetCachedPath(text, voice, speed) != ""
}

// GenerateAndCache synthesizes to the persistent cache in the background.
// It never returns an error to the caller (best-effort warming).
func (e *LocalEngine) GenerateAndCache(text, voice string, speed float64) string {
	if !e.IsAvailable() {
		return ""
	}
	if p := e.GetCachedPath(text, voice, speed); p != "" {
		return p
	}
	wavPath, err := e.synth(text, voice, speed)
	if err != nil {
		return ""
	}
	if err := os.MkdirAll(e.cacheDir, 0o755); err != nil {
		return ""
	}
	dest := filepath.Join(e.cacheDir, hashCacheKey(voice, speed, text)+".wav")
	// Copy (not rename): the service writes to /tmp, often a different
	// filesystem where rename would fail with EXDEV.
	if err := copyFile(wavPath, dest); err != nil {
		return ""
	}
	_ = os.Remove(wavPath)
	return dest
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// Speak synthesizes one verse locally and plays it.
func (e *LocalEngine) Speak(text string) error {
	if !e.IsAvailable() {
		return errors.New("local TTS engine not configured")
	}
	if err := e.Stop(); err != nil {
		return err
	}
	e.mu.Lock()
	voice, speed := e.voice, e.speed
	e.mu.Unlock()

	e.emit(SpeakingState(text))
	wavPath, err := e.synth(text, voice, speed)
	if err != nil {
		if errors.Is(err, ErrStopped) {
			e.emit(IdleState())
			return nil
		}
		e.emit(ErrorState(err.Error()))
		return err
	}
	if err := e.play.play(wavPath); err != nil {
		_ = os.Remove(wavPath)
		if errors.Is(err, ErrStopped) {
			e.emit(IdleState())
			return nil
		}
		e.emit(ErrorState(err.Error()))
		return err
	}
	_ = os.Remove(wavPath)
	e.emit(IdleState())
	return nil
}

func (e *LocalEngine) Prefetch(_ string) error { return nil }

func (e *LocalEngine) Stop() error {
	e.play.kill()
	e.emit(IdleState())
	return nil
}

func (e *LocalEngine) OnStateChange(l func(State)) {
	e.listenerMu.Lock()
	e.listener = l
	e.listenerMu.Unlock()
}

func (e *LocalEngine) UpdateConfig(voice string, speed float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if voice != "" {
		e.voice = voice
	}
	if speed > 0 {
		e.speed = speed
	}
}

// Stats counts persistent cache entries.
func (e *LocalEngine) Stats() (int, string) {
	entries, err := os.ReadDir(e.cacheDir)
	if err != nil {
		return 0, "local"
	}
	n := 0
	for _, ent := range entries {
		if !ent.IsDir() && strings.HasSuffix(ent.Name(), ".wav") {
			n++
		}
	}
	return n, "local"
}

// Cleanup kills the Python service (called on app quit).
func (e *LocalEngine) Cleanup() {
	e.svcMu.Lock()
	defer e.svcMu.Unlock()
	if e.svc != nil && e.svc.Process != nil {
		_ = e.svc.Process.Signal(syscall.SIGTERM)
	}
}

// ---------------------------------------------------------------------------
// Hybrid (OpenRouter live + local cache warming)
// ---------------------------------------------------------------------------

// HybridEngine plays cache hits instantly from disk and cache misses live
// via OpenRouter while warming the local cache in the background.
type HybridEngine struct {
	open  *OpenRouterEngine
	local *LocalEngine

	mu         sync.Mutex
	voice      string
	speed      float64
	lastSource string

	play player

	listenerMu sync.Mutex
	listener   func(State)
}

// NewHybrid combines an OpenRouter engine with a local cache engine.
func NewHybrid(open *OpenRouterEngine, local *LocalEngine) *HybridEngine {
	return &HybridEngine{open: open, local: local, voice: DefaultVoice, speed: DefaultSpeed, lastSource: "none"}
}

func (e *HybridEngine) emit(s State) {
	e.listenerMu.Lock()
	l := e.listener
	e.listenerMu.Unlock()
	if l != nil {
		l(s)
	}
}

func (e *HybridEngine) IsAvailable() bool {
	return e.open.IsAvailable() || e.local.IsAvailable()
}

func (e *HybridEngine) Speak(text string) error {
	if !e.IsAvailable() {
		return errors.New("TTS engine not configured")
	}
	if err := e.Stop(); err != nil {
		return err
	}
	e.mu.Lock()
	voice, speed := e.voice, e.speed
	e.mu.Unlock()

	e.emit(SpeakingState(text))
	if cached := e.local.GetCachedPath(text, voice, speed); cached != "" {
		e.mu.Lock()
		e.lastSource = "local"
		e.mu.Unlock()
		if err := e.play.play(cached); err != nil {
			if errors.Is(err, ErrStopped) {
				e.emit(IdleState())
				return nil
			}
			e.emit(ErrorState(err.Error()))
			return err
		}
		e.emit(IdleState())
		return nil
	}

	e.mu.Lock()
	e.lastSource = "openrouter"
	e.mu.Unlock()
	go e.local.GenerateAndCache(text, voice, speed)
	if err := e.open.Speak(text); err != nil {
		if errors.Is(err, ErrStopped) {
			e.emit(IdleState())
			return nil
		}
		e.emit(ErrorState(err.Error()))
		return err
	}
	e.emit(IdleState())
	return nil
}

func (e *HybridEngine) Prefetch(text string) error {
	if !e.IsAvailable() {
		return nil
	}
	e.mu.Lock()
	voice, speed := e.voice, e.speed
	e.mu.Unlock()
	// The local warmer is intentionally NOT triggered here: it would flood
	// the slow single-threaded local service. The current verse is warmed
	// in Speak instead.
	if e.local.IsCached(text, voice, speed) {
		return nil
	}
	return e.open.Prefetch(text)
}

func (e *HybridEngine) Stop() error {
	e.play.kill()
	_ = e.open.Stop()
	_ = e.local.Stop()
	e.emit(IdleState())
	return nil
}

func (e *HybridEngine) OnStateChange(l func(State)) {
	e.listenerMu.Lock()
	e.listener = l
	e.listenerMu.Unlock()
}

func (e *HybridEngine) UpdateConfig(voice string, speed float64) {
	e.mu.Lock()
	if voice != "" {
		e.voice = voice
	}
	if speed > 0 {
		e.speed = speed
	}
	e.mu.Unlock()
	e.open.UpdateConfig(voice, speed)
	e.local.UpdateConfig(voice, speed)
}

func (e *HybridEngine) Stats() (int, string) {
	cached, _ := e.local.Stats()
	e.mu.Lock()
	defer e.mu.Unlock()
	return cached, e.lastSource
}

func (e *HybridEngine) Cleanup() {
	e.open.Cleanup()
	e.local.Cleanup()
}

// NewEngine wires the engines in the same priority order as Electron's
// createTTSEngine: hybrid > OpenRouter-only > local-only > stub.
func NewEngine(servicePath, pythonPath string) Engine {
	local := NewLocal(servicePath, pythonPath)
	hasLocal := local.HasPrerequisites()
	apiKey := ResolveAPIKey()

	if apiKey != "" && len(apiKey) >= 10 && hasLocal {
		println("[TTS] Hybrid engine: OpenRouter live + local cache warming.")
		return NewHybrid(NewOpenRouter(apiKey), local)
	}
	if apiKey != "" && len(apiKey) >= 10 {
		println("[TTS] Kokoro TTS engine initialized (OpenRouter).")
		return NewOpenRouter(apiKey)
	}
	if hasLocal {
		println("[TTS] Using local Kokoro engine (slow, offline).")
		return local
	}
	println("[TTS] No local Kokoro or OpenRouter key found. TTS disabled.")
	return NewStub()
}
