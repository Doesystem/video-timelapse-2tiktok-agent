import { describe, it, expect, vi } from "vitest"
import { createMockContext } from "@lifetimesoft/agent-sdk/testing"
import agent from "./index"

describe("video-timelapse-2tiktok-agent", () => {
    it("has __isAgent flag", () => {
        expect(agent.__isAgent).toBe(true)
    })

    it("logs starting message", async () => {
        const mockInfo = vi.fn()

        const ctx = createMockContext({
            config: { agent: "video-timelapse-2tiktok-agent", version: "0.0.1", scheduler: { type: "none" } },
            log: { info: mockInfo },
        })

        await agent.run(ctx)

        expect(mockInfo).toHaveBeenCalledTimes(1)
        expect(mockInfo).toHaveBeenNthCalledWith(1, "video-timelapse-2tiktok-agent starting...")
    })

    it("returns undefined (no output)", async () => {
        const ctx = createMockContext()
        const result = await agent.run(ctx)
        expect(result).toBeUndefined()
    })
})
