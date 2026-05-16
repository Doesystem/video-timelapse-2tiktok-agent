/// <reference types="chrome" />

interface ScriptResult {
    url: string
    logs: string[]
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

                log("step: click New project")
                const newProjBtn = findButton("New project")
                if (newProjBtn) { newProjBtn.click(); await sleep(5000); log("ok: New project clicked") }
                else log("skip: New project button not found")

                const beforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)
                log(`step: click Add Media (existing imgs: ${beforeImgs.length})`)
                const addMediaBtn = findButton("Add Media") || findButton("add_2Create")
                if (addMediaBtn) { addMediaBtn.click(); await sleep(1000); log("ok: Add Media clicked") }
                else log("skip: Add Media button not found")

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

                log("step: open settings and set 9:16")
                const settingsBtn = findButton("Nano Banana")
                if (settingsBtn) {
                    settingsBtn.click(); await sleep(1000)
                    const ratioBtn = findButton("9:16")
                    if (ratioBtn) { ratioBtn.click(); log("ok: 9:16 selected") }
                    else log("skip: 9:16 button not found")
                    await sleep(500)
                    document.body.click(); await sleep(500)
                } else log("skip: settings button not found")

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

                log("step: wait for generated image")
                const newBeforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)
                let generatedUrl = ""
                for (let i = 0; i < 60; i++) {
                    await sleep(2000)
                    const currentImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]'))
                    const newImg = currentImgs.find(img => !newBeforeImgs.includes(img.src))
                    if (newImg) { generatedUrl = newImg.src; log(`ok: generated image found at i=${i}`); break }
                }
                if (!generatedUrl) log("error: generated image not found after 120s")

                return { url: generatedUrl, logs }
            },
            args: [imageUrl, prompt]
        })

        const result = results[0]?.result as ScriptResult | undefined
        if (result?.logs) {
            for (const line of result.logs) log(`[chrome-flow] ${line}`)
        }
        if (!result?.url) throw new Error("Could not find generated image URL")
        setTimeout(() => chrome.tabs.remove(tabId), 1000)
        return result.url
    } catch (err) {
        chrome.tabs.remove(tabId).catch(() => {})
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
