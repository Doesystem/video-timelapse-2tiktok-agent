import { defineAgent } from "@lifetimesoft/agent-sdk"
import { generateBeforeImageInChrome, generateVideoInChrome } from "./chrome-flow-api"

export type Category = "home" | "furniture"

export interface VideoTimelapseInput {
    image_url: string   // after image
    product: string
    description: string
    category: Category
}

interface VideoTimelapseOutput {
    video_url: string
    status: "completed" | "failed"
    product: string
    category: string
    before_prompt: string
    before_image_url: string
    after_image_url: string
}

function buildBeforePrompt(category: Category): string {
    switch (category) {
        case "furniture":
            return "เอาเฟอร์นิเจอร์และของตกแต่งออกให้หน่อย ให้เหลือแค่สภาพห้องเปล่าให้เหมือนเดิม"
        case "home":
            return "เอารูปบ้านออกให้หน่อย ให้เหลือแค่สภาพแวดล้อมให้เหมือนเดิม"
    }
}

function buildVideoPrompt(category: Category): string {
    switch (category) {
        case "home":
            return "สร้าง VDO timelapse โดยใช้มุมกล้องแบบคงที่ ต้องการให้มีคนงานเข้าไปทำงานก่อสร้าง ตกแต่ง ยกของ มีการนำเครื่องจักรมาใช้งาน จากรูปที่ 1 จนเสร็จเป็นรูปที่ 2"
        case "furniture":
            return "สร้าง VDO timelapse โดยใช้มุมกล้องแบบคงที่ แสดงการจัดวางและตกแต่งเฟอร์นิเจอร์ในพื้นที่ จากรูปที่ 1 จนเสร็จเป็นรูปที่ 2"
    }
}

export default defineAgent<VideoTimelapseInput, VideoTimelapseOutput>({
    async run(ctx) {
        const input = ctx.input as VideoTimelapseInput | null

        ctx.log.info("[video-timelapse-2tiktok-agent] ctx.input: " + JSON.stringify(ctx.input))

        if (!input?.image_url?.trim()) {
            ctx.log.error("[video-timelapse-2tiktok-agent] Missing required field: image_url")
            return { video_url: "", status: "failed", product: input?.product ?? "", category: input?.category ?? "", before_prompt: "", before_image_url: "", after_image_url: "" }
        }
        if (!input?.category) {
            ctx.log.error("[video-timelapse-2tiktok-agent] Missing required field: category")
            return { video_url: "", status: "failed", product: input?.product ?? "", category: "", before_prompt: "", before_image_url: "", after_image_url: "" }
        }

        const { image_url, product, description, category } = input

        ctx.log.info(`[video-timelapse-2tiktok-agent] Starting for product: ${product} (${category})`)
        ctx.log.info(`[video-timelapse-2tiktok-agent] After image (input): ${image_url}`)

        // Step 1: Generate "before" image via Chrome automation
        ctx.log.info("[Step 1] Generating before image from after reference via Chrome...")
        const beforePrompt = buildBeforePrompt(category)
        ctx.log.info(`[Step 1] prompt: ${beforePrompt}`)

        let beforeImageUrl = ""
        try {
            beforeImageUrl = await generateBeforeImageInChrome(image_url, beforePrompt)
            ctx.log.info("[Step 1] response before image_url: " + beforeImageUrl)
        } catch (err) {
            ctx.log.error(`[Step 1] failed: ${err}`)
            return { video_url: "", status: "failed", product, category, before_prompt: beforePrompt, before_image_url: "", after_image_url: image_url }
        }

        // Step 2: Create timelapse video via Chrome automation
        ctx.log.info("[Step 2] Creating 9:16 timelapse video (before → after) via Chrome...")
        const videoPrompt = buildVideoPrompt(category)
        ctx.log.info(`[Step 2] prompt: ${videoPrompt}`)

        let videoUrl = ""
        try {
            videoUrl = await generateVideoInChrome(beforeImageUrl, image_url, videoPrompt)
            ctx.log.info("[Step 2] response video_url: " + videoUrl)
        } catch (err) {
            ctx.log.error(`[Step 2] failed: ${err}`)
            return { video_url: "", status: "failed", product, category, before_prompt: beforePrompt, before_image_url: beforeImageUrl, after_image_url: image_url }
        }

        ctx.log.info("[video-timelapse-2tiktok-agent] Done.")

        return {
            video_url: videoUrl,
            status: "completed",
            product,
            category,
            before_prompt: beforePrompt,
            before_image_url: beforeImageUrl,
            after_image_url: image_url,
        }
    },
})
