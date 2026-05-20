/// <reference types="chrome" />

import {
    FLOW_URL,
    INITIAL_PAGE_LOAD_MS,
    closeTabSoon,
    createActiveTab,
    delay,
    logScriptResult,
    trustedClick,
    type ClickPoint,
    type LogFn,
    type ScriptResult,
} from "./chrome-flow-shared"
export async function generateVideoInChrome(beforeUrl: string, afterUrl: string, prompt: string, log: LogFn): Promise<string> {
    const tabId = await createActiveTab(FLOW_URL, "Failed to create Flow tab")

    try {
        await delay(INITIAL_PAGE_LOAD_MS)

        const clickFlowPoint = async (point: ClickPoint, label: string) => {
            log(`[chrome-flow] step: click ${label}`)
            await trustedClick(tabId, point)
            await delay(900)
            log(`[chrome-flow] ok: ${label} clicked`)
        }

        const locateAndClick = async (kind: string, label: string, required = true) => {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: (targetKind: string): { point?: { x: number; y: number }; alreadyOpen?: boolean; logs: string[] } => {
                    const logs: string[] = []
                    const isVisible = (el: Element) => {
                        const r = el.getBoundingClientRect()
                        const s = getComputedStyle(el)
                        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"
                    }
                    const pointOf = (el: Element) => {
                        const r = el.getBoundingClientRect()
                        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
                    }
                    const text = (el: Element) => el.textContent?.trim().replace(/\s+/g, " ") ?? ""
                    let el: Element | undefined

                    if (targetKind === "model-chip") {
                        const openMenu = document.querySelector('[data-radix-menu-content][data-state="open"], [role="menu"][data-state="open"]')
                        if (openMenu && Array.from(openMenu.querySelectorAll('[role="tab"]')).length > 0) {
                            logs.push("ok: settings panel already open")
                            return { alreadyOpen: true, logs }
                        }

                        el = Array.from(document.querySelectorAll("button"))
                            .filter(isVisible)
                            .find(b => {
                                const label = text(b)
                                return label.includes("Nano Banana") ||
                                    label.includes("Veo") ||
                                    (b.getAttribute("aria-haspopup") === "menu" && label.includes("Video"))
                            })
                    }

                    if (targetKind === "model-chip" && el && (el.getAttribute("aria-expanded") === "true" || el.getAttribute("data-state") === "open")) {
                        logs.push(`ok: settings trigger already open text="${text(el).slice(0, 80)}"`)
                        return { alreadyOpen: true, logs }
                    }
                    if (targetKind === "scenebuilder") {
                        el = Array.from(document.querySelectorAll("button"))
                            .filter(isVisible)
                            .find(b => text(b).includes("Scenebuilder") || text(b).includes("play_movies"))
                    }
                    if (targetKind === "video-tab") {
                        el = Array.from(document.querySelectorAll('[role="tab"]'))
                            .filter(isVisible)
                            .find(t => t.id.includes("trigger-VIDEO") && !t.id.includes("VIDEO_FRAMES") && !t.id.includes("VIDEO_REFERENCES"))
                    }
                    if (targetKind === "frames-tab") {
                        el = Array.from(document.querySelectorAll('[role="tab"]'))
                            .filter(isVisible)
                            .find(t => t.id.includes("VIDEO_FRAMES"))
                    }
                    if (targetKind === "portrait-tab") {
                        el = Array.from(document.querySelectorAll('[role="tab"]'))
                            .filter(isVisible)
                            .find(t => t.id.includes("PORTRAIT") || text(t).includes("9:16"))
                    }
                    if (targetKind === "count-1x") {
                        el = Array.from(document.querySelectorAll('[role="tab"], button'))
                            .filter(isVisible)
                            .find(t => text(t) === "1x")
                    }
                    if (targetKind === "veo-chip") {
                        el = Array.from(document.querySelectorAll('button[aria-haspopup="menu"], button'))
                            .filter(isVisible)
                            .find(b => text(b).includes("Veo"))
                    }
                    if (targetKind === "veo-fast") {
                        el = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'))
                            .filter(isVisible)
                            .find(o => text(o).includes("Veo 3.1 - Fast"))
                    }

                    if (!el) {
                        const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => `${(t as HTMLElement).id}:${text(t)}`).slice(0, 20)
                        const buttons = Array.from(document.querySelectorAll("button")).map(b => text(b)).filter(Boolean).slice(0, 25)
                        logs.push(`skip: ${targetKind} not found; tabs=${JSON.stringify(tabs)} buttons=${JSON.stringify(buttons)}`)
                        return { logs }
                    }

                    const point = pointOf(el)
                    logs.push(`ok: ${targetKind} located at ${JSON.stringify(point)} text="${text(el).slice(0, 80)}"`)
                    return { point, logs }
                },
                args: [kind],
            })

            const result = results[0]?.result as { point?: { x: number; y: number }; alreadyOpen?: boolean; logs?: string[] } | undefined
            logScriptResult("chrome-flow", result, log)
            if (result?.alreadyOpen) return true
            if (!result?.point) {
                if (required) throw new Error(`Could not find ${label}`)
                return false
            }
            await clickFlowPoint(result.point, label)
            return true
        }

        const waitAndClick = async (kind: string, label: string, timeoutMs = 15000, intervalMs = 1000) => {
            const deadline = Date.now() + timeoutMs
            let lastError: unknown
            while (Date.now() < deadline) {
                try {
                    if (await locateAndClick(kind, label, false)) return true
                } catch (err) {
                    lastError = err
                }
                await delay(intervalMs)
            }
            if (lastError) log(`[chrome-flow] warn: last ${label} lookup error: ${String(lastError)}`)
            return false
        }

        const startResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (): Promise<{ logs: string[] }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))

                log("step: click New project")
                const newProjBtn = findButton("New project")
                if (newProjBtn) { newProjBtn.click(); await sleep(5000); log("ok: New project clicked") }
                else log("skip: New project button not found")
                return { logs }
            },
        })
        logScriptResult("chrome-flow", startResults[0]?.result, log)

        const openedSettings = await waitAndClick("model-chip", "settings panel", 12000, 1000)
        if (!openedSettings) {
            await locateAndClick("scenebuilder", "Scenebuilder")
            await delay(2500)
            if (!await waitAndClick("model-chip", "settings panel", 20000, 1000)) {
                throw new Error("Could not find settings panel")
            }
        }
        await locateAndClick("video-tab", "Video mode")
        await locateAndClick("frames-tab", "Frames mode")
        await locateAndClick("portrait-tab", "9:16")
        await locateAndClick("count-1x", "1x")
        if (await locateAndClick("veo-chip", "Veo menu", false)) {
            await locateAndClick("veo-fast", "Veo 3.1 - Fast", false)
        }
        const closeSettingsResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: (): { x: number; y: number } | null => {
                const visible = (el: Element) => {
                    const rect = (el as HTMLElement).getBoundingClientRect()
                    const style = window.getComputedStyle(el as HTMLElement)
                    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
                }
                const chips = Array.from(document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]'))
                    .filter(visible)
                    .filter((el) => {
                        const text = (el.textContent || "").replace(/\s+/g, " ").trim()
                        return text.includes("Video") || text.includes("Veo") || text.includes("Nano Banana")
                    })
                const openChip = chips.find((el) => el.getAttribute("aria-expanded") === "true" || el.getAttribute("data-state") === "open")
                const el = openChip || chips[0]
                if (!el) return null
                const rect = el.getBoundingClientRect()
                return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
            },
        })
        const closeSettingsPoint = closeSettingsResults[0]?.result
        if (closeSettingsPoint) await clickFlowPoint(closeSettingsPoint, "close settings panel")
        await delay(500)
        log("[chrome-flow] ok: video settings configured")

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (startImgUrl: string, endImgUrl: string, textPrompt: string): Promise<{ url: string; logs: string[]; createClick?: { x: number; y: number }; existingVideos?: string[] }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))
                const isClickable = (button: HTMLButtonElement) => {
                    const style = getComputedStyle(button)
                    const rect = button.getBoundingClientRect()
                    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none" && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true"
                }

                const uploadAndWait = async (imgUrl: string, label: string) => {
                    log(`step: upload ${label}`)
                    const beforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)
                    const addMediaBtn = findButton("Add Media") || findButton("add_2Create")
                    if (addMediaBtn) { addMediaBtn.click(); await sleep(1000) }
                    else { log(`skip: Add Media not found for ${label}`); return null }

                    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
                    if (fileInput) {
                        try {
                            const res = await fetch(imgUrl)
                            const blob = await res.blob()
                            const file = new File([blob], "frame.png", { type: blob.type })
                            const dt = new DataTransfer()
                            dt.items.add(file)
                            fileInput.files = dt.files
                            fileInput.dispatchEvent(new Event('change', { bubbles: true }))
                            log(`ok: ${label} file dispatched (${blob.size} bytes)`)
                        } catch (e) { log(`error: ${label} upload failed — ${e}`); return null }
                    } else { log(`skip: file input not found for ${label}`); return null }

                    for (let i = 0; i < 30; i++) {
                        await sleep(1000)
                        const currentImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]'))
                        const uploaded = currentImgs.find(img => !beforeImgs.includes(img.src))
                        if (uploaded) { log(`ok: ${label} appeared at i=${i}`); return uploaded.src }
                    }
                    log(`warn: ${label} not found after 30s`)
                    return null
                }

                try {
                const startSrc = await uploadAndWait(startImgUrl, "start frame")
                const endSrc = await uploadAndWait(endImgUrl, "end frame")

                log("step: upload success")
                const selectFrame = async (buttonText: string, src: string | null) => {
                    if (!src) { log(`skip: selectFrame "${buttonText}" — no src`); return }
                    log(`step: select ${buttonText} frame`)
                    const btn = Array.from(document.querySelectorAll<HTMLElement>('[type="button"]'))
                        .filter((d) => {
                            const rect = d.getBoundingClientRect()
                            const style = window.getComputedStyle(d)
                            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
                        })
                        .find((d) => d.textContent?.trim() === buttonText)
                    const dialogImagesOnly = () => {
                        const popups = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [data-radix-dialog-content], [data-radix-popper-content-wrapper]'))
                            .filter((el) => {
                                const rect = el.getBoundingClientRect()
                                const style = window.getComputedStyle(el)
                                return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
                            })
                        const popup = popups[popups.length - 1]
                        if (!popup) {
                            throw new Error(`Could not find ${buttonText} frame picker popup`)
                        }
                        return Array.from(popup.querySelectorAll<HTMLImageElement>("img"))
                    }
                    if (!btn) {
                        throw new Error(`Could not find ${buttonText} frame button`)
                    }
                    btn.click()
                    await sleep(600)
                    const nameId = (src.split("name=")[1] || src).split("&")[0]

                    const list = document.querySelector<HTMLElement>('[role="dialog"] [data-testid="virtuoso-item-list"]')
                    if (!list) {
                        throw new Error(`Could not find ${buttonText} frame picker list`)
                    }

                    const row = Array.from(list.querySelectorAll<HTMLElement>('div[data-item-index]'))
                        .find((el) => Array.from(el.querySelectorAll<HTMLImageElement>("img")).some((img) => img.src.includes(nameId)))

                    if (!row) {
                        const fallbackImg = dialogImagesOnly().find((img) => img.src.includes(nameId))
                        const fallbackRow = fallbackImg?.closest<HTMLElement>('div[data-item-index], [role="option"], [role="button"], button')
                        if (!fallbackRow) throw new Error(`Could not find ${buttonText} image row inside frame picker popup`)
                        fallbackRow.click()
                    } else {
                        const clickable = row.querySelector<HTMLElement>('[role="option"]') || row
                        clickable.click()
                    }

                    await sleep(600)
                    log(`ok: ${buttonText} frame selected`)
                }

                log("step: selectFrame start -> end")
                await selectFrame("Start", startSrc)
                await selectFrame("End", endSrc)

                log("step: type prompt into Slate editor")
                const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement
                if (editor) {
                    editor.focus(); await sleep(300)
                    document.execCommand('selectAll', false)
                    document.execCommand('delete', false)
                    await sleep(300)
                    editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: textPrompt, bubbles: true, cancelable: true }))
                    document.execCommand('insertText', false, textPrompt)
                    editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: textPrompt, bubbles: true }))
                    await sleep(500)
                    log(`ok: prompt typed (${textPrompt.length} chars)`)
                } else log("warn: Slate editor not found")

                log("step: click Create button")
                const createBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const text = b.textContent?.trim() ?? ""
                    return text === "Create" || text.endsWith("Create") || text.includes("arrow_forwardCreate")
                }) as HTMLButtonElement[]
                const createBtn = createBtns.filter(isClickable).sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]
                if (!createBtn) { log("warn: Create button not found"); return { url: "", logs } }
                const r = createBtn.getBoundingClientRect()
                const createClick = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
                const existingVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video')).map(v => v.src).filter(Boolean)
                log(`ok: Create button located at ${JSON.stringify(createClick)}`)
                return { url: "", logs, createClick, existingVideos }
                } catch (err) {
                    log(`error: video setup script threw: ${err instanceof Error ? err.message : String(err)}`)
                    return { url: "", logs }
                }
            },
            args: [beforeUrl, afterUrl, prompt]
        })

        log('results: ' + JSON.stringify(results))
        log("step: click Create button")
        const result = results[0]?.result as ScriptResult | undefined
        logScriptResult("chrome-flow", result, log)
        if (!result) log(`[chrome-flow] error: executeScript returned no result: ${JSON.stringify(results)}`)
        if (!result?.createClick) {
            throw new Error("Could not find video Create button coordinates")
        }

        await clickFlowPoint(result.createClick, "Create video")
        const waitResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (videosBeforeCreate: string[]): Promise<{ url: string; logs: string[] }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                log("step: wait for generated video")
                const existingVideos = videosBeforeCreate.filter(Boolean)
                let generatedUrl = ""
                for (let i = 0; i < 150; i++) {
                    await sleep(2000)
                    const currentVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
                    const newVid = currentVideos.find(v => v.src && !existingVideos.includes(v.src))
                    if (newVid) { generatedUrl = newVid.src; log(`ok: video found at i=${i}`); break }
                    if (i === 15 || i === 60 || i === 120) log(`debug: waiting video i=${i}`)
                }
                if (!generatedUrl) log("error: video not found after 300s")
                return { url: generatedUrl, logs }
            },
            args: [result.existingVideos ?? []],
        })
        const waitResult = waitResults[0]?.result as ScriptResult | undefined
        logScriptResult("chrome-flow", waitResult, log)
        if (!waitResult?.url) throw new Error("Could not find generated video URL")
        closeTabSoon(tabId)
        return waitResult.url
    } catch (err) {
        chrome.tabs.remove(tabId).catch(() => {})
        throw err
    }
}
