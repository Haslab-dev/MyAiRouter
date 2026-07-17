package middleware

import (
	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/rtk"
)

func Compression(ctx *context.GatewayContext, next HandlerFunc) error {
	ctx.AddStep("Compression", "started", "Running token compression (RTK Bolt & Headroom)")

	settings, err := db.GetSettings()
	if err == nil && settings != nil {
		// 1. RTK Bolt compression (modifies request body messages in-place)
		rtk.CompressMessages(ctx.RequestBody, settings.RtkEnabled)

		// 2. Headroom context check
		if settings.HeadroomEnabled && settings.HeadroomUrl != "" {
			if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
				compressed := rtk.CompressWithHeadroom(ctx.Context, settings.HeadroomUrl, ctx.Model, msgs)
				ctx.RequestBody["messages"] = compressed
				ctx.AddStep("Compression", "success", "RTK Bolt & Headroom compression executed")
			}
		} else {
			ctx.AddStep("Compression", "success", "RTK Bolt compression executed")
		}
	} else {
		ctx.AddStep("Compression", "skipped", "Compression disabled or settings not found")
	}

	return next(ctx)
}
