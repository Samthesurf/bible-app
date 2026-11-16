package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"

	"github.com/wailsapp/wails/v2/pkg/options"

	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:dist
var assets embed.FS

//go:embed build/icon.png
var windowIcon []byte

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:             "Bible App",
		Width:             1280,
		Height:            860,
		MinWidth:          720,
		MinHeight:         560,
		BackgroundColour:  &options.RGBA{R: 252, G: 252, B: 252, A: 1},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.samuelsurf.bibleapp",
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Linux: &linux.Options{
			Icon:             windowIcon,
			ProgramName:      "bible-app-wails",
			WebviewGpuPolicy: linux.WebviewGpuPolicyNever,
		},
		OnStartup:  app.Startup,
		OnShutdown: app.Shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
