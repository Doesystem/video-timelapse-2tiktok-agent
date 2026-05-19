/// <reference types="chrome" />

interface ScriptResult {
    url: string
    logs: string[]
    createClick?: { x: number; y: number }
    existingVideos?: string[]
}

type LogFn = (msg: string) => void

const TIKTOK_STUDIO_UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video"

export async function generateBeforeImageInChrome(imageUrl: string, prompt: string, log: LogFn): Promise<string> {
    const tab = await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error("Failed to create tab")
    const tabId = tab.id

    try {
        await new Promise(r => setTimeout(r, 8000))

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (imgUrl: string, textPrompt: string): Promise<{ url: string; logs: string[]; createClick?: { x: number; y: number } }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
                const debug = false
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))
                const getMediaUrls = () => {
                    const urls = [
                        ...Array.from(document.querySelectorAll<HTMLImageElement>('img')).map(img => img.src),
                        ...Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map(a => a.href),
                        ...Array.from(document.querySelectorAll<HTMLElement>('*')).flatMap(el => {
                            const bg = getComputedStyle(el).backgroundImage
                            return Array.from(bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)).map(match => match[1])
                        }),
                    ]
                    return Array.from(new Set(urls.filter(url => url && (url.includes("media.getMediaUrlRedirect") || url.includes("googleusercontent.com")))))
                }
                const snapshot = (label: string) => {
                    if (!debug) return
                    const active = document.activeElement
                    const buttons = Array.from(document.querySelectorAll('button')).map((b, index) => ({
                        index,
                        text: b.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
                        disabled: b.hasAttribute("disabled"),
                        ariaDisabled: b.getAttribute("aria-disabled"),
                        rect: (() => {
                            const r = b.getBoundingClientRect()
                            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
                        })(),
                    })).filter(b => b.text || b.rect.w || b.rect.h)
                    log(`monitor: ${label}: active=${active?.tagName ?? ""} text="${active?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? ""}"`)
                    log(`monitor: ${label}: buttons=${JSON.stringify(buttons.slice(0, 40))}`)
                    log(`monitor: ${label}: media=${JSON.stringify(getMediaUrls().slice(0, 10))}`)
                    log(`monitor: ${label}: body="${document.body.innerText.replace(/\s+/g, " ").slice(0, 500)}"`)
                }
                const isClickable = (button: HTMLButtonElement) => {
                    const style = getComputedStyle(button)
                    const rect = button.getBoundingClientRect()
                    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none" && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true"
                }
                const fireRealClick = (button: HTMLButtonElement) => {
                    button.scrollIntoView({ block: "center", inline: "center" })
                    button.focus()
                    const rect = button.getBoundingClientRect()
                    const x = rect.left + rect.width / 2
                    const y = rect.top + rect.height / 2
                    const target = document.elementFromPoint(x, y) as HTMLElement | null
                    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
                        const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: type.endsWith("down") ? 1 : 0 }
                        const event = type.startsWith("pointer")
                            ? new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true })
                            : new MouseEvent(type, eventInit)
                        ;(target ?? button).dispatchEvent(event)
                    }
                    button.click()
                }
                const pressEnterOnEditor = async () => {
                    const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement | null
                    if (!editor) { log("warn: cannot press Enter — Slate editor not found"); return }
                    editor.focus()
                    await sleep(300)
                    for (const target of [editor, document]) {
                        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }))
                        target.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }))
                        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }))
                    }
                    log("ok: Enter pressed before Create")
                    await sleep(1000)
                }

                log("step: click New project")
                snapshot("initial page")
                const newProjBtn = findButton("New project")
                if (newProjBtn) { newProjBtn.click(); await sleep(5000); log("ok: New project clicked") }
                else log("skip: New project button not found")
                snapshot("after New project")

                const beforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)
                log(`step: click Add Media (existing imgs: ${beforeImgs.length})`)
                const addMediaBtn = findButton("Add Media") || findButton("add_2Create")
                if (addMediaBtn) { addMediaBtn.click(); await sleep(1000); log("ok: Add Media clicked") }
                else log("skip: Add Media button not found")
                snapshot("after Add Media")

                log("step: upload image via file input")
                const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
                if (fileInput) {
                    try {
                        const res = await fetch(imgUrl)
                        const blob = await res.blob()
                        const file = new File([blob], "image.png", { type: blob.type })
                        const dt = new DataTransfer()
                        dt.items.add(file)
                        fileInput.files = dt.files
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }))
                        log(`ok: file dispatched (${blob.type}, ${blob.size} bytes)`)
                    } catch (e) { log(`error: upload failed — ${e}`) }
                } else log("skip: file input not found")
                snapshot("after file dispatch")

                log("step: wait for uploaded image to appear")
                let uploadedImg: HTMLImageElement | undefined
                for (let i = 0; i < 30; i++) {
                    await sleep(1000)
                    const currentImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]'))
                    uploadedImg = currentImgs.find(img => !beforeImgs.includes(img.src))
                    if (uploadedImg) { log(`ok: uploaded image found at i=${i}`); break }
                }
                if (!uploadedImg) log("warn: uploaded image not found after 30s")
                else { uploadedImg.click(); await sleep(2000); log("ok: uploaded image clicked") }
                snapshot("after uploaded image click")

                log("step: open settings and set 9:16")
                const settingsBtn = findButton("Nano Banana")
                if (settingsBtn) {
                    settingsBtn.click(); await sleep(1000)
                    // Debug: dump all button texts to find correct 9:16 selector
                    const allBtns = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
                    const allTabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim()).filter(Boolean)
                    if (debug) {
                        log(`debug: buttons in settings = ${JSON.stringify(allBtns.slice(0, 20))}`)
                        log(`debug: tabs = ${JSON.stringify(allTabs)}`)
                    }
                    const ratioBtn = findButton("9:16")
                    if (ratioBtn) { ratioBtn.click(); log("ok: 9:16 selected") }
                    else log("skip: 9:16 button not found")
                    await sleep(500)
                    document.body.click(); await sleep(500)
                } else log("skip: settings button not found")
                snapshot("after settings")

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
                    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
                    editor.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
                    await sleep(1000)
                    log(`ok: prompt typed (${textPrompt.length} chars)`)
                } else log("warn: Slate editor not found")
                snapshot("after prompt typed")

                log("step: locate Create button")
                snapshot("before Create")
                await pressEnterOnEditor()
                const createBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const text = b.textContent?.trim() ?? ""
                    return text === "Create" || text.endsWith("Create") || text.includes("arrow_forwardCreate")
                }) as HTMLButtonElement[]
                const clickableCreateBtns = createBtns.filter(isClickable)
                const describeButton = (button: HTMLButtonElement | undefined) => {
                    if (!button) return null
                    const r = button.getBoundingClientRect()
                    return {
                        text: button.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ?? "",
                        disabled: button.hasAttribute("disabled"),
                        ariaDisabled: button.getAttribute("aria-disabled"),
                        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                    }
                }
                const scoreCreateButton = (button: HTMLButtonElement) => {
                    const text = button.textContent?.trim().replace(/\s+/g, "") ?? ""
                    const r = button.getBoundingClientRect()
                    let score = 0
                    if (text === "arrow_forwardCreate") score += 100
                    if (text.includes("arrow_forwardCreate")) score += 80
                    if (text === "Create") score += 40
                    if (r.y > window.innerHeight * 0.35) score += 20
                    if (r.x > window.innerWidth * 0.5) score += 30
                    return score
                }
                const createBtn = [...clickableCreateBtns].sort((a, b) => scoreCreateButton(b) - scoreCreateButton(a))[0]
                const editorContent = document.querySelector('[data-slate-editor="true"]')?.textContent ?? ""
                if (debug) {
                    log(`debug: editor content = "${editorContent.slice(0, 100)}"`)
                    log(`debug: create candidates = ${JSON.stringify(clickableCreateBtns.map(describeButton))}`)
                    log(`debug: selected create = ${JSON.stringify(describeButton(createBtn))}`)
                }
                const mediaBeforeCreate = getMediaUrls()
                const textBeforeCreate = document.body.innerText.replace(/\s+/g, " ")
                if (!createBtn) {
                    log("warn: clickable Create button not found")
                    return { url: "", logs }
                }

                const createRect = createBtn.getBoundingClientRect()
                const createClick = {
                    x: Math.round(createRect.left + createRect.width / 2),
                    y: Math.round(createRect.top + createRect.height / 2),
                }
                log(`ok: Create button located at ${JSON.stringify(createClick)}`)

                return { url: "", logs, createClick }
            },
            args: [imageUrl, prompt]
        })

        const result = results[0]?.result as ScriptResult | undefined
        if (result?.logs) {
            for (const line of result.logs) log(`[chrome-flow] ${line}`)
        }
        if (!result?.createClick) throw new Error("Could not find Create button coordinates")

        log(`[chrome-flow] step: trusted click Create at ${JSON.stringify(result.createClick)}`)
        await (chrome as unknown as { debugger: { click: (payload: { tabId: number; x: number; y: number }) => Promise<unknown> } }).debugger.click({ tabId, ...result.createClick })
        await new Promise(r => setTimeout(r, 2000))

        const waitResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (): Promise<{ url: string; logs: string[] }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const getMediaUrls = () => {
                    const urls = [
                        ...Array.from(document.querySelectorAll<HTMLImageElement>('img')).map(img => img.src),
                        ...Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map(a => a.href),
                        ...Array.from(document.querySelectorAll<HTMLElement>('*')).flatMap(el => {
                            const bg = getComputedStyle(el).backgroundImage
                            return Array.from(bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)).map(match => match[1])
                        }),
                    ]
                    return Array.from(new Set(urls.filter(url => url && (url.includes("media.getMediaUrlRedirect") || url.includes("googleusercontent.com")))))
                }
                const snapshot = (label: string) => {
                    return
                    const active = document.activeElement
                    const buttons = Array.from(document.querySelectorAll('button')).map((b, index) => ({
                        index,
                        text: b.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
                        disabled: b.hasAttribute("disabled"),
                        ariaDisabled: b.getAttribute("aria-disabled"),
                        rect: (() => {
                            const r = b.getBoundingClientRect()
                            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
                        })(),
                    })).filter(b => b.text || b.rect.w || b.rect.h)
                    log(`monitor: ${label}: active=${active?.tagName ?? ""} text="${active?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? ""}"`)
                    log(`monitor: ${label}: buttons=${JSON.stringify(buttons.slice(0, 40))}`)
                    log(`monitor: ${label}: media=${JSON.stringify(getMediaUrls().slice(0, 10))}`)
                    log(`monitor: ${label}: body="${document.body.innerText.replace(/\s+/g, " ").slice(0, 500)}"`)
                }

                snapshot("after trusted Create click")
                log("step: wait for generated image")
                const beforeUrls = getMediaUrls()
                let generatedUrl = ""
                for (let i = 0; i < 60; i++) {
                    await sleep(2000)
                    const currentUrls = getMediaUrls()
                    const newUrl = currentUrls.find(url => !beforeUrls.includes(url))
                    if (newUrl) { generatedUrl = newUrl; log(`ok: generated image found at i=${i}`); break }
                    if (i === 30 || i === 59) {
                        const bodyText = document.body.innerText.replace(/\s+/g, " ").slice(0, 500)
                        log(`debug: still waiting image i=${i}; media=${JSON.stringify(currentUrls.slice(0, 5))}; page="${bodyText}"`)
                    }
                }
                if (!generatedUrl) log("error: generated image not found after 120s")
                return { url: generatedUrl, logs }
            },
        })

        const waitResult = waitResults[0]?.result as ScriptResult | undefined
        if (waitResult?.logs) {
            for (const line of waitResult.logs) log(`[chrome-flow] ${line}`)
        }
        if (!waitResult?.url) throw new Error("Could not find generated image URL")
        setTimeout(() => chrome.tabs.remove(tabId), 1000)
        return waitResult.url
    } catch (err) {
        log(`[chrome-flow] leaving tab ${tabId} open for inspection after error`)
        throw err
    }
}

export async function generateVideoInChrome(beforeUrl: string, afterUrl: string, prompt: string, log: LogFn): Promise<string> {
    const tab = await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error("Failed to create tab")
    const tabId = tab.id

    try {
        await new Promise(r => setTimeout(r, 8000))

        const trustedClick = async (point: { x: number; y: number }, label: string) => {
            log(`[chrome-flow] step: click ${label}`)
            await (chrome as unknown as { debugger: { click: (payload: { tabId: number; x: number; y: number }) => Promise<unknown> } }).debugger.click({ tabId, ...point })
            await new Promise(r => setTimeout(r, 900))
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
            for (const line of result?.logs ?? []) log(`[chrome-flow] ${line}`)
            if (result?.alreadyOpen) return true
            if (!result?.point) {
                if (required) throw new Error(`Could not find ${label}`)
                return false
            }
            await trustedClick(result.point, label)
            return true
        }

        const waitForPageSettle = (ms: number) => new Promise(r => setTimeout(r, ms))
        const waitAndClick = async (kind: string, label: string, timeoutMs = 15000, intervalMs = 1000) => {
            const deadline = Date.now() + timeoutMs
            let lastError: unknown
            while (Date.now() < deadline) {
                try {
                    if (await locateAndClick(kind, label, false)) return true
                } catch (err) {
                    lastError = err
                }
                await waitForPageSettle(intervalMs)
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
        for (const line of startResults[0]?.result?.logs ?? []) log(`[chrome-flow] ${line}`)

        const openedSettings = await waitAndClick("model-chip", "settings panel", 12000, 1000)
        if (!openedSettings) {
            await locateAndClick("scenebuilder", "Scenebuilder")
            await waitForPageSettle(2500)
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
        if (closeSettingsPoint) await trustedClick(closeSettingsPoint, "close settings panel")
        await waitForPageSettle(500)
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

                const startSrc = await uploadAndWait(startImgUrl, "start frame")
                const endSrc = await uploadAndWait(endImgUrl, "end frame")

                const selectFrame = async (buttonText: string, src: string | null) => {
                    if (!src) { log(`skip: selectFrame "${buttonText}" — no src`); return }
                    log(`step: select ${buttonText} frame`)
                    const btn = Array.from(document.querySelectorAll<HTMLElement>('div[type="button"][aria-haspopup="dialog"]'))
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
                        if (!popup) throw new Error(`Could not find ${buttonText} frame picker popup`)
                        return Array.from(popup.querySelectorAll<HTMLImageElement>("img"))
                    }
                    if (!btn) throw new Error(`Could not find ${buttonText} frame button`)
                    btn.click()
                    await sleep(600)
                    const nameId = (src.split("name=")[1] || src).split("&")[0]
                    const list = document.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')
                    if (!list) throw new Error(`Could not find ${buttonText} frame picker list`)
                    const row = Array.from(list.querySelectorAll<HTMLElement>('div[class*="sc-1dc6bdcb-15"]'))
                        .find((el) => Array.from(el.querySelectorAll<HTMLImageElement>("img")).some((img) => img.src.includes(nameId)))
                    if (!row) {
                        const fallbackImg = dialogImagesOnly().find((img) => img.src.includes(nameId))
                        const fallbackRow = fallbackImg?.closest<HTMLElement>('div[class*="sc-1dc6bdcb-15"], [role="button"], button')
                        if (!fallbackRow) throw new Error(`Could not find ${buttonText} image row inside frame picker popup`)
                        fallbackRow.click()
                    } else {
                        row.click()
                    }
                    await sleep(600)
                    log(`ok: ${buttonText} frame selected`)
                }

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
            },
            args: [beforeUrl, afterUrl, prompt]
        })

        const result = results[0]?.result as ScriptResult | undefined
        if (result?.logs) {
            for (const line of result.logs) log(`[chrome-flow] ${line}`)
        }
        if (!result?.createClick) throw new Error("Could not find video Create button coordinates")

        await trustedClick(result.createClick, "Create video")
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
        if (waitResult?.logs) {
            for (const line of waitResult.logs) log(`[chrome-flow] ${line}`)
        }
        if (!waitResult?.url) throw new Error("Could not find generated video URL")
        setTimeout(() => chrome.tabs.remove(tabId), 1000)
        return waitResult.url
    } catch (err) {
        chrome.tabs.remove(tabId).catch(() => {})
        throw err
    }
}

export async function uploadVideoToTikTokStudioInChrome(videoUrl: string, caption: string, log: LogFn, productId = ""): Promise<void> {
    const tab = await chrome.tabs.create({ url: TIKTOK_STUDIO_UPLOAD_URL, active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error("Failed to create TikTok upload tab")
    const tabId = tab.id

    try {
        log("[tiktok-upload] step: fetch generated video via extension host")
        const fetchedVideo = await (chrome as unknown as {
            fetchDataUrl: (url: string) => Promise<{ dataUrl: string; type: string; size: number }>
        }).fetchDataUrl(videoUrl)
        log(`[tiktok-upload] ok: generated video fetched (${fetchedVideo.size} bytes, ${fetchedVideo.type})`)

        await new Promise(r => setTimeout(r, 8000))
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
                            return { logs, ok: true }
                        }
                    }

                    log("warn: TikTok upload dispatch completed, but no visible page reaction detected")
                    if (!await waitForUploadComplete()) return { logs, ok: false }
                    if (!await setCaption()) return { logs, ok: false }
                    if (!await addProductLink()) return { logs, ok: false }
                    return { logs, ok: true }
                } catch (err) {
                    log(`error: TikTok upload script threw: ${err instanceof Error ? err.message : String(err)}`)
                    return { logs, ok: false }
                }
            },
            args: [fetchedVideo.dataUrl, fetchedVideo.type, caption, productId],
        })

        const result = results[0]?.result as { logs?: string[]; ok?: boolean } | undefined
        for (const line of result?.logs ?? []) log(`[tiktok-upload] ${line}`)
        if (!result) log(`[tiktok-upload] error: executeScript returned no result: ${JSON.stringify(results)}`)
        if (!result?.ok) throw new Error("TikTok upload failed")
    } catch (err) {
        log(`[tiktok-upload] leaving tab ${tabId} open for inspection after error`)
        throw err
    }
}
