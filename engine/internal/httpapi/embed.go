package httpapi

import (
	"embed"
)

//go:embed all:static
var StaticFS embed.FS
