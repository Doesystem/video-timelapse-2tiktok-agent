/// <reference types="chrome" />

interface ScriptResult {
    url: string
    logs: string[]
    createClick?: { x: number; y: number }
}

type LogFn = (msg: string) => void

export async function generateBeforeImageInChrome(imageUrl: string, prompt: string, log: LogFn): Promise<string> {
    const tab = await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error("Failed to create tab")
    const tabId = tab.id

    try {
        await new Promise(r => setTimeout(r, 8000))

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (imgUrl: string, textPrompt: string): Promise<{ url: string; logs: string[] }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
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
                    log(`debug: buttons in settings = ${JSON.stringify(allBtns.slice(0, 20))}`)
                    const allTabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim()).filter(Boolean)
                    log(`debug: tabs = ${JSON.stringify(allTabs)}`)
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
                log(`debug: editor content = "${editorContent.slice(0, 100)}"`)
                log(`debug: create candidates = ${JSON.stringify(clickableCreateBtns.map(describeButton))}`)
                log(`debug: selected create = ${JSON.stringify(describeButton(createBtn))}`)
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
                    if (i === 0 || i === 5 || i === 15 || i === 30 || i === 45 || i === 59) {
                        const bodyText = document.body.innerText.replace(/\s+/g, " ").slice(0, 500)
                        log(`debug: media urls at i=${i} = ${JSON.stringify(currentUrls.slice(0, 10))}`)
                        log(`debug: page text at i=${i} = "${bodyText}"`)
                        snapshot(`generation poll i=${i}`)
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

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (startImgUrl: string, endImgUrl: string, textPrompt: string): Promise<{ url: string; logs: string[] }> => {
                const logs: string[] = []
                const log = (msg: string) => { logs.push(msg); console.log("[flow-agent]", msg) }
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))
                const findTab = (text: string) => Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.textContent?.includes(text)) as HTMLElement

                log("step: click New project")
                const newProjBtn = findButton("New project")
                if (newProjBtn) { newProjBtn.click(); await sleep(5000); log("ok: New project clicked") }
                else log("skip: New project button not found")

                log("step: open settings panel")
                const settingsBtn = findButton("Nano Banana")
                if (settingsBtn) {
                    settingsBtn.click(); await sleep(1000)

                    const videoTab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.id.includes("trigger-VIDEO") && !t.id.includes("FRAMES"))
                    if (videoTab) { (videoTab as HTMLElement).click(); log("ok: Video tab clicked") }
                    else log("skip: Video tab not found")
                    await sleep(800)

                    const framesTab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.id.includes("VIDEO_FRAMES"))
                    if (framesTab) { (framesTab as HTMLElement).click(); log("ok: Frames tab clicked") }
                    else log("skip: Frames tab not found")
                    await sleep(500)

                    const portraitTab = findTab("9:16")
                    if (portraitTab) { portraitTab.click(); log("ok: 9:16 selected") }
                    else log("skip: 9:16 tab not found")
                    await sleep(500)

                    const countTab = findTab("1x")
                    if (countTab) { countTab.click(); log("ok: 1x selected") }
                    else log("skip: 1x tab not found")
                    await sleep(500)

                    const veoMenu = document.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
                    if (veoMenu && veoMenu.textContent?.includes("Veo")) {
                        veoMenu.click(); await sleep(800)
                        const veoFast = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).find(o => o.textContent?.includes("Veo 3.1 - Fast")) as HTMLElement
                        if (veoFast) { veoFast.click(); log("ok: Veo 3.1 Fast selected") }
                        else log("skip: Veo 3.1 Fast option not found")
                        await sleep(500)
                    } else log("skip: Veo menu not found")

                    document.body.click(); await sleep(1000); log("ok: settings closed")
                } else log("skip: settings button not found")

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
                    const btn = Array.from(document.querySelectorAll('div[type="button"]')).find(d => d.textContent?.includes(buttonText)) as HTMLElement
                    if (btn) {
                        btn.click(); await sleep(1000)
                        const nameId = src.split("name=")[1]
                        if (nameId) {
                            const imgs = Array.from(document.querySelectorAll('[data-testid="virtuoso-item-list"] img')) as HTMLImageElement[]
                            const targetImg = imgs.find(i => i.src.includes(nameId))
                            if (targetImg) {
                                let row = targetImg.parentElement as HTMLElement
                                while (row && !row.className.includes("sc-")) row = row.parentElement as HTMLElement
                                if (row) { row.click(); await sleep(500); log(`ok: ${buttonText} frame selected`) }
                                else log(`warn: ${buttonText} frame row not found`)
                            } else log(`warn: ${buttonText} frame img not found by nameId`)
                        }
                    } else log(`warn: ${buttonText} frame button not found`)
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
                    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
                    editor.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
                    await sleep(1000)
                    log(`ok: prompt typed (${textPrompt.length} chars)`)
                } else log("warn: Slate editor not found")

                log("step: click Create button")
                const createBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Create' || b.textContent?.includes('Create'))
                const createBtn = createBtns[createBtns.length - 1]
                if (createBtn) { createBtn.click(); await sleep(500); log("ok: Create clicked") }
                else log("warn: Create button not found")

                log("step: wait for generated video")
                const existingVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video')).map(v => v.src)
                let generatedUrl = ""
                for (let i = 0; i < 150; i++) {
                    await sleep(2000)
                    const currentVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
                    const newVid = currentVideos.find(v => v.src && !existingVideos.includes(v.src))
                    if (newVid) { generatedUrl = newVid.src; log(`ok: video found at i=${i}`); break }
                }
                if (!generatedUrl) log("error: video not found after 300s")

                return { url: generatedUrl, logs }
            },
            args: [beforeUrl, afterUrl, prompt]
        })

        const result = results[0]?.result as ScriptResult | undefined
        if (result?.logs) {
            for (const line of result.logs) log(`[chrome-flow] ${line}`)
        }
        if (!result?.url) throw new Error("Could not find generated video URL")
        setTimeout(() => chrome.tabs.remove(tabId), 1000)
        return result.url
    } catch (err) {
        chrome.tabs.remove(tabId).catch(() => {})
        throw err
    }
}
