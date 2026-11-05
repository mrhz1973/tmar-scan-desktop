# Reticle framing integration checkpoint

The plugin optionally publishes the visible control cage bounds, including handles and arrows, in part-local coordinates with the current draft stamp. Older hosts without this capability remain supported. The host owns the explicit camera action; the plugin does not move the camera. Bounds are revoked when unavailable, on errors and on layer disposal.

Forty focused and existing tests and TypeScript passed. Tests cover transformed parent coordinates, handles outside the pole box, current stamps, invalid data, old hosts, publisher failures and synchronous re-entry including disposal. One re-entry test initially detected work continuing after disposal; the layer now stops immediately after a publisher revokes it. These tests use a simulated host, not the actual PR #30 host or a packaged desktop build. End-to-end integration and owner GUI acceptance remain open.

Additional re-entry fix: a simulated synchronous host callback changed transparency while the previous update was still running. The previous update incorrectly restored opacity 0.9 instead of the new 0.4; a revision fence now prevents stale state from being applied. The reproduction and 40 related tests pass, as does TypeScript. Actual host and packaged-desktop qualification remain open.
