/// <reference types="chrome" />

import {
    INITIAL_PAGE_LOAD_MS,
    TIKTOK_STUDIO_UPLOAD_URL,
    chromeExtensionBridge,
    createActiveTab,
    delay,
    logScriptResult,
    type LogFn,
} from "./chrome-flow-shared"
export async function uploadVideoToTikTokStudioInChrome(videoUrl: string, caption: string, log: LogFn, productId = ""): Promise<void> {
    const tabId = await createActiveTab(TIKTOK_STUDIO_UPLOAD_URL, "Failed to create TikTok upload tab")

    try {
        log("[tiktok-upload] step: fetch generated video via extension host")
        const fetchedVideo = await chromeExtensionBridge().fetchDataUrl(videoUrl)
        log(`[tiktok-upload] ok: generated video fetched (${fetchedVideo.size} bytes, ${fetchedVideo.type})`)

        await delay(INITIAL_PAGE_LOAD_MS)
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (sourceVideoDataUrl: string, sourceVideoType: string, captionText: string, productIdText: string): Promise<{ logs: string[]; ok: boolean }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[tiktok-upload]", msg) }
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const visible = (el: Element) => {
                    const rect = (el as HTMLElement).getBoundingClientRect()
                    const style = window.getComputedStyle(el as HTMLElement)
                    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
                }
                const clickElement = (el: HTMLElement) => {
                    el.scrollIntoView({ block: "center", inline: "center" })
                    el.focus()
                    const rect = el.getBoundingClientRect()
                    const x = rect.left + rect.width / 2
                    const y = rect.top + rect.height / 2
                    const target = document.elementFromPoint(x, y) as HTMLElement | null
                    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
                        const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: type.endsWith("down") ? 1 : 0 }
                        const event = type.startsWith("pointer")
                            ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
                            : new MouseEvent(type, init)
                        ;(target ?? el).dispatchEvent(event)
                    }
                    el.click()
                }
                const setInputValue = (input: HTMLInputElement, value: string) => {
                    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
                    setter?.call(input, value)
                    input.dispatchEvent(new Event("input", { bubbles: true }))
                    input.dispatchEvent(new Event("change", { bubbles: true }))
                }
                const waitForFileInput = async () => {
                    for (let i = 0; i < 90; i++) {
                        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
                        const videoInput = inputs.find(input => {
                            const accept = input.accept || ""
                            return accept.includes("video") || accept.includes("mp4") || inputs.length === 1
                        })
                        if (videoInput) return videoInput
                        if (i === 0 || i === 15 || i === 45) {
                            const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                            const buttons = Array.from(document.querySelectorAll("button")).filter(visible).map(b => b.textContent?.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 12)
                            log(`waiting for TikTok file input i=${i}; buttons=${JSON.stringify(buttons)} body="${bodyText}"`)
                        }
                        await sleep(1000)
                    }
                    return null
                }

                try {
                    const waitForUploadComplete = async () => {
                        log("step: wait 10s after TikTok upload starts before caption")
                        for (let i = 0; i < 10; i++) {
                            await sleep(1000)
                            const pageText = document.body?.innerText?.replace(/\s+/g, " ") ?? ""
                            if (/something went wrong|please try again|upload failed|failed to upload|เกิดข้อผิดพลาด|ลองอีกครั้ง/i.test(pageText)) {
                                log(`error: TikTok upload failed before caption; body="${pageText.slice(0, 240)}"`)
                                return false
                            }
                        }
                        log("ok: waited 10s after TikTok upload starts")
                        return true
                    }

                    const setCaption = async () => {
                        log("step: wait for TikTok caption editor")
                        const captionTextForEditor = captionText.trim()
                        for (let i = 0; i < 120; i++) {
                            const editor = document.querySelector<HTMLElement>('.caption-editor [contenteditable="true"], [contenteditable="true"][role="combobox"]')
                            if (editor) {
                                editor.focus()
                                await sleep(300)
                                document.execCommand("selectAll", false)
                                document.execCommand("delete", false)
                                await sleep(700)

                                try {
                                    const dt = new DataTransfer()
                                    dt.setData("text/plain", captionTextForEditor)
                                    const pasted = editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
                                    log(`ok: TikTok caption paste event dispatched accepted=${pasted}`)
                                } catch (err) {
                                    log(`warn: TikTok caption paste event failed: ${err instanceof Error ? err.message : String(err)}`)
                                }

                                editor.dispatchEvent(new Event("change", { bubbles: true }))
                                let lastCaption = ""
                                let stableCaptionTicks = 0
                                for (let j = 0; j < 10; j++) {
                                    await sleep(500)
                                    const observedCaption = (editor.innerText || editor.textContent || "").trim()
                                    if (observedCaption === lastCaption && observedCaption.length > 0) {
                                        stableCaptionTicks += 1
                                    } else {
                                        stableCaptionTicks = 0
                                        lastCaption = observedCaption
                                    }
                                    if (stableCaptionTicks >= 2) break
                                }
                                let currentCaption = (editor.innerText || editor.textContent || "").trim()
                                if (!currentCaption) {
                                    log("warn: TikTok caption paste left editor empty; inserting text once")
                                    document.execCommand("insertText", false, captionTextForEditor)
                                    editor.dispatchEvent(new Event("change", { bubbles: true }))
                                    await sleep(1500)
                                    currentCaption = (editor.innerText || editor.textContent || "").trim()
                                }
                                const duplicateCaption = `${captionTextForEditor}\n${captionTextForEditor}`.trim()
                                if (currentCaption === duplicateCaption || currentCaption.includes(duplicateCaption)) {
                                    log("warn: duplicate TikTok caption detected; rewriting once")
                                    document.execCommand("selectAll", false)
                                    document.execCommand("delete", false)
                                    await sleep(500)
                                    const dt = new DataTransfer()
                                    dt.setData("text/plain", captionTextForEditor)
                                    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
                                    editor.dispatchEvent(new Event("change", { bubbles: true }))
                                }
                                await sleep(5000)
                                const bodyText = document.body?.innerText ?? ""
                                if (/something went wrong|please try again|upload failed|failed to upload|เกิดข้อผิดพลาด|ลองอีกครั้ง/i.test(bodyText)) {
                                    log(`error: TikTok rejected after caption; body="${bodyText.replace(/\s+/g, " ").slice(0, 240)}"`)
                                    return false
                                }
                                log(`ok: caption typed (${captionTextForEditor.length} chars)`)
                                return true
                            }
                            if (i === 0 || i === 15 || i === 45 || i === 90) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for TikTok caption editor i=${i}; body="${bodyText}"`)
                            }
                            await sleep(1000)
                        }
                        log("error: TikTok caption editor not found")
                        return false
                    }

                    const addProductLink = async () => {
                        const productIdForSearch = productIdText.trim()
                        if (!productIdForSearch) {
                            log("skip: product_id not provided; product link not added")
                            return true
                        }

                        log(`step: add TikTok product link product_id=${productIdForSearch}`)
                        for (let i = 0; i < 30; i++) {
                            const addButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".anchor-tag-container button, button"))
                                .filter((button) => visible(button))
                                .find((button) => {
                                    const text = button.textContent?.replace(/\s+/g, " ").trim() ?? ""
                                    return text === "Add" && button.getAttribute("aria-disabled") !== "true" && button.getAttribute("data-disabled") !== "true" && !button.disabled
                                })
                            if (addButton) {
                                clickElement(addButton)
                                log(`ok: Add link button clicked at i=${i}`)
                                break
                            }
                            if (i === 0 || i === 10 || i === 20) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for TikTok Add link button i=${i}; body="${bodyText}"`)
                            }
                            await sleep(1000)
                            if (i === 29) {
                                log("error: TikTok Add link button not found")
                                return false
                            }
                        }

                        for (let i = 0; i < 30; i++) {
                            await sleep(500)
                            const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], .TUXModal'))
                                .filter((el) => visible(el))
                                .find((el) => /add link/i.test(el.textContent ?? ""))
                            const nextButton = dialog
                                ? Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
                                    .filter((button) => visible(button))
                                    .find((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim() === "Next" && button.getAttribute("aria-disabled") !== "true" && !button.disabled)
                                : null
                            if (nextButton) {
                                clickElement(nextButton)
                                log(`ok: Add link Next clicked at i=${i}`)
                                break
                            }
                            if (i === 0 || i === 10 || i === 20) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for Add link Next button i=${i}; body="${bodyText}"`)
                            }
                            if (i === 29) {
                                log("error: Add link Next button not found")
                                return false
                            }
                        }

                        for (let i = 0; i < 30; i++) {
                            await sleep(500)
                            const searchInput = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="Search products"], input[type="text"]'))
                                .filter((input) => visible(input))
                                .find((input) => /search products/i.test(input.placeholder) || input.closest(".product-search-input-container"))
                            if (searchInput) {
                                searchInput.focus()
                                await sleep(300)
                                setInputValue(searchInput, productIdForSearch)
                                searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
                                searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
                                log(`ok: product_id typed into Search products (${productIdForSearch})`)
                                break
                            }
                            if (i === 0 || i === 10 || i === 20) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for product search input i=${i}; body="${bodyText}"`)
                            }
                            if (i === 29) {
                                log("error: product search input not found")
                                return false
                            }
                        }

                        for (let i = 0; i < 40; i++) {
                            await sleep(500)
                            const radioContainer = Array.from(document.querySelectorAll<HTMLElement>(".TUXRadio"))
                                .filter((container) => visible(container))
                                .find((container) => {
                                    const input = container.querySelector<HTMLInputElement>('input[type="radio"]')
                                    return input && !input.disabled && container.getAttribute("data-disabled") !== "true"
                                })
                            const radio = radioContainer?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null
                            if (radio) {
                                const clickTarget =
                                    radioContainer?.querySelector<HTMLElement>(".TUXRadioStandalone") ??
                                    radioContainer ??
                                    radio
                                clickElement(clickTarget)
                                await sleep(300)
                                radio.focus()
                                radio.click()
                                radio.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true, cancelable: true }))
                                radio.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true, cancelable: true }))
                                await sleep(700)

                                const nextReady = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
                                    .filter((button) => visible(button))
                                    .some((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim() === "Next" && button.getAttribute("aria-disabled") !== "true" && !button.disabled)
                                if (radio.checked || nextReady) {
                                    log(`ok: product radio selected at i=${i}`)
                                    break
                                }
                                log(`waiting for product radio selection to apply i=${i}`)
                            }
                            if (i === 0 || i === 10 || i === 25) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for product radio i=${i}; body="${bodyText}"`)
                            }
                            if (i === 39) {
                                log("error: product radio not found")
                                return false
                            }
                        }

                        for (let i = 0; i < 30; i++) {
                            await sleep(500)
                            const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], .TUXModal')).filter((el) => visible(el))
                            const dialog = dialogs.length > 0 ? dialogs[dialogs.length - 1] : null
                            const nextButtons = dialog
                                ? Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
                                : Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
                            const nextButton = nextButtons
                                .filter((button) => visible(button))
                                .find((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim() === "Next" && button.getAttribute("aria-disabled") !== "true" && !button.disabled)
                            if (nextButton) {
                                clickElement(nextButton)
                                log(`ok: product select Next clicked at i=${i}`)
                                break
                            }
                            if (i === 0 || i === 10 || i === 20) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for product select Next button i=${i}; body="${bodyText}"`)
                            }
                            if (i === 29) {
                                log("error: product select Next button not found")
                                return false
                            }
                        }

                        for (let i = 0; i < 30; i++) {
                            await sleep(500)
                            const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], .TUXModal')).filter((el) => visible(el))
                            const dialog = dialogs.length > 0 ? dialogs[dialogs.length - 1] : null
                            const addButtons = dialog
                                ? Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
                                : Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
                            const addButton = addButtons
                                .filter((button) => visible(button))
                                .find((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim() === "Add" && button.getAttribute("aria-disabled") !== "true" && !button.disabled)
                            if (addButton) {
                                clickElement(addButton)
                                log(`ok: product link Add clicked at i=${i}`)
                                return true
                            }
                            if (i === 0 || i === 10 || i === 20) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for product link Add button i=${i}; body="${bodyText}"`)
                            }
                        }

                        log("error: product link Add button not found")
                        return false
                    }

                    const enableAIGeneratedContent = async () => {
                        log("step: enable TikTok AI-generated content setting")

                        for (let i = 0; i < 20; i++) {
                            const container = document.querySelector<HTMLElement>('[data-e2e="advanced_settings_container"]')
                            const showMoreButton = container?.querySelector<HTMLElement>(".more-btn") ??
                                Array.from(document.querySelectorAll<HTMLElement>("span, div, button"))
                                    .filter((el) => visible(el))
                                    .find((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim() === "Show more")
                            const collapsed = container?.className.includes("collapsed") ?? true
                            if (showMoreButton && collapsed) {
                                clickElement(showMoreButton)
                                log(`ok: Show more clicked at i=${i}`)
                                await sleep(1000)
                                break
                            }
                            if (container && !collapsed) {
                                log("ok: advanced settings already expanded")
                                break
                            }
                            if (i === 0 || i === 10) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for Show more i=${i}; body="${bodyText}"`)
                            }
                            await sleep(1000)
                        }

                        for (let i = 0; i < 30; i++) {
                            const aigcContainer = document.querySelector<HTMLElement>('[data-e2e="aigc_container"]')
                            const switchContent = aigcContainer?.querySelector<HTMLElement>('[role="switch"], .Switch__content')
                            const switchInput = aigcContainer?.querySelector<HTMLInputElement>('input[type="checkbox"], input[role="switch"]')
                            const checked =
                                switchContent?.getAttribute("aria-checked") === "true" ||
                                switchContent?.getAttribute("data-state") === "checked" ||
                                switchInput?.checked === true

                            if (checked) {
                                log("ok: AI-generated content setting already enabled")
                                return true
                            }
                            if (switchContent || switchInput) {
                                clickElement((switchContent ?? switchInput) as HTMLElement)
                                await sleep(1000)
                                const nowChecked =
                                    switchContent?.getAttribute("aria-checked") === "true" ||
                                    switchContent?.getAttribute("data-state") === "checked" ||
                                    switchInput?.checked === true
                                if (nowChecked) {
                                    log(`ok: AI-generated content setting enabled at i=${i}`)
                                    return true
                                }
                                log(`waiting for AI-generated content switch to enable i=${i}`)
                            }
                            if (i === 0 || i === 10 || i === 20) {
                                const bodyText = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 240) ?? ""
                                log(`waiting for AI-generated content switch i=${i}; body="${bodyText}"`)
                            }
                            await sleep(1000)
                        }

                        log("error: AI-generated content switch not found or did not enable")
                        return false
                    }

                    log(`step: wait for TikTok upload input url=${location.href}`)
                    const fileInput = await waitForFileInput()
                    if (!fileInput) {
                        log("error: TikTok file input not found")
                        return { logs, ok: false }
                    }

                    log("step: build generated video file")
                    const res = await fetch(sourceVideoDataUrl)
                    if (!res.ok) {
                        log(`error: video fetch failed (${res.status})`)
                        return { logs, ok: false }
                    }
                    const blob = await res.blob()
                    const file = new File([blob], `timelapse-${Date.now()}.mp4`, { type: sourceVideoType || blob.type || "video/mp4" })
                    const dt = new DataTransfer()
                    dt.items.add(file)
                    fileInput.files = dt.files
                    fileInput.dispatchEvent(new Event("input", { bubbles: true }))
                    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
                    log(`ok: TikTok video file dispatched (${blob.size} bytes, ${file.type})`)

                    for (let i = 0; i < 60; i++) {
                        await sleep(1000)
                        const pageText = document.body?.innerText ?? ""
                        const hasUploadProgress = /upload|processing|post|caption|cover|description/i.test(pageText)
                        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video")).filter(visible)
                        if (videos.length > 0 || hasUploadProgress) {
                            log(`ok: TikTok upload page reacted at i=${i}`)
                            if (!await waitForUploadComplete()) return { logs, ok: false }
                            if (!await setCaption()) return { logs, ok: false }
                            if (!await addProductLink()) return { logs, ok: false }
                            if (!await enableAIGeneratedContent()) return { logs, ok: false }
                            return { logs, ok: true }
                        }
                    }

                    log("warn: TikTok upload dispatch completed, but no visible page reaction detected")
                    if (!await waitForUploadComplete()) return { logs, ok: false }
                    if (!await setCaption()) return { logs, ok: false }
                    if (!await addProductLink()) return { logs, ok: false }
                    if (!await enableAIGeneratedContent()) return { logs, ok: false }
                    return { logs, ok: true }
                } catch (err) {
                    log(`error: TikTok upload script threw: ${err instanceof Error ? err.message : String(err)}`)
                    return { logs, ok: false }
                }
            },
            args: [fetchedVideo.dataUrl, fetchedVideo.type, caption, productId],
        })

        const result = results[0]?.result as { logs?: string[]; ok?: boolean } | undefined
        logScriptResult("tiktok-upload", result, log)
        if (!result) log(`[tiktok-upload] error: executeScript returned no result: ${JSON.stringify(results)}`)
        if (!result?.ok) throw new Error("TikTok upload failed")
    } catch (err) {
        log(`[tiktok-upload] leaving tab ${tabId} open for inspection after error`)
        throw err
    }
}
