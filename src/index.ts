import { defineAgent } from "@lifetimesoft/agent-sdk"
import {
    generateBeforeImageInChrome,
    generateVideoInChrome,
    uploadVideoToTikTokStudioInChrome,
} from "./chrome-flow-api"

const AGENT_NAME = "video-timelapse-2tiktok-agent"
const SKIP_STEP1 = false
const SKIP_STEP2 = false
const MOCK_VIDEO_URL = "https://static.lifetimesoft.com/ai/agent/videos-temp/b3f9bbf7-4649-4b85-b319-af7606295991.mp4"

export type Category = "home" | "furniture"

export interface VideoTimelapseInput {
    image_url: string
    product_id: string
    product: string
    description: string
    category: Category
}

export interface VideoTimelapseOutput {
    video_url: string
    status: "completed" | "failed"
    product_id: string
    product: string
    category: string
    before_prompt: string
    before_image_url: string
    after_image_url: string
    tiktok_upload_status: "completed" | "failed" | "skipped"
}

type LogFn = (message: string) => void

const HASHTAGS_BY_CATEGORY: Record<Category, string[]> = {
    home: ["#แบบบ้าน", "#แบบบ้านสวยๆ", "#บ้าน", "#สร้างบ้าน", "#บ้านโมเดิร์น"],
    furniture: ["#แต่งบ้าน", "#เฟอร์นิเจอร์", "#ออกแบบภายใน", "#บ้านสวย", "#ไอเดียแต่งบ้าน"],
}

const BEFORE_PROMPT_BY_CATEGORY: Record<Category, string> = {
    furniture: "เอาเฟอร์นิเจอร์และของตกแต่งออกให้หน่อย ให้เหลือแค่สภาพห้องเปล่าให้เหมือนเดิม",
    home: "เอารูปบ้านออกให้หน่อย ให้เหลือแค่สภาพแวดล้อมให้เหมือนเดิม",
}

const VIDEO_PROMPT_BY_CATEGORY: Record<Category, string> = {
    home: "สร้าง VDO timelapse โดยใช้มุมกล้องแบบคงที่ ต้องการให้มีคนงานเข้าไปทำงานก่อสร้าง ตกแต่ง ยกของ มีการนำเครื่องจักรมาใช้งาน จากรูปที่ 1 จนเสร็จเป็นรูปที่ 2",
    furniture: "สร้าง VDO timelapse โดยใช้มุมกล้องแบบคงที่ แสดงการจัดวางและตกแต่งเฟอร์นิเจอร์ในพื้นที่ จากรูปที่ 1 จนเสร็จเป็นรูปที่ 2",
}

const isCategory = (value: unknown): value is Category =>
    typeof value === "string" && value in HASHTAGS_BY_CATEGORY

function emptyOutput(input?: Partial<VideoTimelapseInput> | null): VideoTimelapseOutput {
    return {
        video_url: "",
        status: "failed",
        product_id: input?.product_id ?? "",
        product: input?.product ?? "",
        category: input?.category ?? "",
        before_prompt: "",
        before_image_url: "",
        after_image_url: input?.image_url ?? "",
        tiktok_upload_status: "skipped",
    }
}

function failedOutput(
    input: VideoTimelapseInput,
    beforePrompt: string,
    beforeImageUrl: string,
    videoUrl = "",
    tiktokUploadStatus: VideoTimelapseOutput["tiktok_upload_status"] = "skipped",
): VideoTimelapseOutput {
    return {
        video_url: videoUrl,
        status: "failed",
        product_id: input.product_id,
        product: input.product,
        category: input.category,
        before_prompt: beforePrompt,
        before_image_url: beforeImageUrl,
        after_image_url: input.image_url,
        tiktok_upload_status: tiktokUploadStatus,
    }
}

function validateInput(input: VideoTimelapseInput | null): VideoTimelapseInput | null {
    if (!input?.image_url?.trim()) return null
    if (!isCategory(input.category)) return null
    return input
}

function buildTikTokCaption(product: string, description: string, category: Category): string {
    return [
        ".",
        product.trim(),
        HASHTAGS_BY_CATEGORY[category].join(" "),
        description.trim(),
        ".",
    ].filter(Boolean).join("\n\n")
}

async function runStep<T>(
    stepName: string,
    log: LogFn,
    action: () => Promise<T>,
): Promise<T> {
    try {
        return await action()
    } catch (err) {
        log(`[${stepName}] failed: ${err instanceof Error ? err.message : String(err)}`)
        throw err
    }
}

export default defineAgent<VideoTimelapseInput, VideoTimelapseOutput>({
    async run(ctx) {
        const input = ctx.input as VideoTimelapseInput | null
        const logInfo = (message: string) => ctx.log.info(message)
        const logError = (message: string) => ctx.log.error(message)

        ctx.log.info(`[${AGENT_NAME}] ctx.input: ${JSON.stringify(ctx.input)}`)

        const validInput = validateInput(input)
        if (!validInput) {
            ctx.log.error(`[${AGENT_NAME}] Missing or invalid required fields: image_url, category`)
            return emptyOutput(input)
        }

        const beforePrompt = BEFORE_PROMPT_BY_CATEGORY[validInput.category]
        const videoPrompt = VIDEO_PROMPT_BY_CATEGORY[validInput.category]
        const tiktokCaption = buildTikTokCaption(
            validInput.product,
            validInput.description,
            validInput.category,
        )

        ctx.log.info(`[${AGENT_NAME}] Starting for product: ${validInput.product} (${validInput.category})`)
        ctx.log.info(`[${AGENT_NAME}] After image (input): ${validInput.image_url}`)
        ctx.log.info(`[${AGENT_NAME}] tiktokCaption: ${tiktokCaption}`)

        let beforeImageUrl = ""
        if (SKIP_STEP1) {
            ctx.log.info("[Step 1] skipped because SKIP_STEP1 is true.")
        } else {
            ctx.log.info("[Step 1] Generating before image from after reference via Chrome...")
            ctx.log.info(`[Step 1] prompt: ${beforePrompt}`)
            try {
                beforeImageUrl = await runStep("Step 1", logError, () =>
                    generateBeforeImageInChrome(validInput.image_url, beforePrompt, logInfo),
                )
                ctx.log.info(`[Step 1] response before image_url: ${beforeImageUrl}`)
            } catch {
                return failedOutput(validInput, beforePrompt, "")
            }
        }

        let videoUrl = ""
        if (SKIP_STEP2) {
            videoUrl = MOCK_VIDEO_URL
            ctx.log.info("[Step 2] skipped because SKIP_STEP2 is true.")
            ctx.log.info(`[Step 2] using mocked video_url: ${videoUrl}`)
        } else {
            ctx.log.info("[Step 2] Creating 9:16 timelapse video (before -> after) via Chrome...")
            ctx.log.info(`[Step 2] prompt: ${videoPrompt}`)
            try {
                videoUrl = await runStep("Step 2", logError, () =>
                    generateVideoInChrome(beforeImageUrl, validInput.image_url, videoPrompt, logInfo),
                )
                ctx.log.info(`[Step 2] response video_url: ${videoUrl}`)
            } catch {
                return failedOutput(validInput, beforePrompt, beforeImageUrl)
            }
        }

        ctx.log.info("[Step 3] Uploading generated video to TikTok Studio...")
        try {
            await runStep("Step 3", logError, () =>
                uploadVideoToTikTokStudioInChrome(videoUrl, tiktokCaption, logInfo, validInput.product_id),
            )
            ctx.log.info("[Step 3] TikTok Studio upload completed.")
        } catch {
            return failedOutput(validInput, beforePrompt, beforeImageUrl, videoUrl, "failed")
        }

        ctx.log.info(`[${AGENT_NAME}] Done.`)

        return {
            video_url: videoUrl,
            status: "completed",
            product_id: validInput.product_id,
            product: validInput.product,
            category: validInput.category,
            before_prompt: beforePrompt,
            before_image_url: beforeImageUrl,
            after_image_url: validInput.image_url,
            tiktok_upload_status: "completed",
        }
    },
})
