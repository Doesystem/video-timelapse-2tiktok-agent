/// <reference types="chrome" />

export async function generateBeforeImageInChrome(imageUrl: string, prompt: string): Promise<string> {
    const tab = await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error("Failed to create tab")
    const tabId = tab.id

    try {
        await new Promise(r => setTimeout(r, 8000))

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (imgUrl: string, textPrompt: string) => {
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))

                const newProjBtn = findButton("New project")
                if (newProjBtn) { newProjBtn.click(); await sleep(5000) }

                const beforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)

                const addMediaBtn = findButton("Add Media") || findButton("add_2Create")
                if (addMediaBtn) { addMediaBtn.click(); await sleep(1000) }

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
                    } catch (e) { console.error("Upload error", e) }
                }

                let uploadedImg: HTMLImageElement | undefined
                for (let i = 0; i < 30; i++) {
                    await sleep(1000)
                    const currentImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]'))
                    uploadedImg = currentImgs.find(img => !beforeImgs.includes(img.src))
                    if (uploadedImg) break
                }
                if (uploadedImg) { uploadedImg.click(); await sleep(2000) }

                const settingsBtn = findButton("Nano Banana")
                if (settingsBtn) {
                    settingsBtn.click(); await sleep(1000)
                    const ratioBtn = findButton("9:16")
                    if (ratioBtn) ratioBtn.click()
                    await sleep(500)
                    document.body.click()
                }

                const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement
                if (editor) {
                    editor.focus()
                    document.execCommand('selectAll', false)
                    document.execCommand('delete', false)
                    document.execCommand('insertText', false, textPrompt)
                    await sleep(1000)
                }

                const createBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes("Create"))
                const createBtn = createBtns[createBtns.length - 1]
                if (createBtn) createBtn.click()

                const newBeforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)
                let generatedUrl = ""
                for (let i = 0; i < 60; i++) {
                    await sleep(2000)
                    const currentImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]'))
                    const newImg = currentImgs.find(img => !newBeforeImgs.includes(img.src))
                    if (newImg) { generatedUrl = newImg.src; break }
                }
                return generatedUrl
            },
            args: [imageUrl, prompt]
        })

        const url = results[0]?.result
        if (!url) throw new Error("Could not find generated image URL")
        setTimeout(() => chrome.tabs.remove(tabId), 1000)
        return url as string
    } catch (err) {
        chrome.tabs.remove(tabId).catch(() => {})
        throw err
    }
}

export async function generateVideoInChrome(beforeUrl: string, afterUrl: string, prompt: string): Promise<string> {
    const tab = await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error("Failed to create tab")
    const tabId = tab.id

    try {
        await new Promise(r => setTimeout(r, 8000))

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (startImgUrl: string, endImgUrl: string, textPrompt: string) => {
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
                const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))
                const findTab = (text: string) => Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.textContent?.includes(text)) as HTMLElement

                const newProjBtn = findButton("New project")
                if (newProjBtn) { newProjBtn.click(); await sleep(5000) }

                const settingsBtn = findButton("Nano Banana")
                if (settingsBtn) {
                    settingsBtn.click(); await sleep(1000)

                    const videoTab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.id.includes("trigger-VIDEO") && !t.id.includes("FRAMES"))
                    if (videoTab) (videoTab as HTMLElement).click()
                    await sleep(800)

                    const framesTab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.id.includes("VIDEO_FRAMES"))
                    if (framesTab) (framesTab as HTMLElement).click()
                    await sleep(500)

                    const portraitTab = findTab("9:16")
                    if (portraitTab) portraitTab.click()
                    await sleep(500)

                    const countTab = findTab("1x")
                    if (countTab) countTab.click()
                    await sleep(500)

                    const veoMenu = document.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
                    if (veoMenu && veoMenu.textContent?.includes("Veo")) {
                        veoMenu.click(); await sleep(800)
                        const veoFast = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).find(o => o.textContent?.includes("Veo 3.1 - Fast")) as HTMLElement
                        if (veoFast) veoFast.click()
                        await sleep(500)
                    }

                    document.body.click(); await sleep(1000)
                }

                const uploadAndWait = async (imgUrl: string) => {
                    const beforeImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]')).map(img => img.src)
                    const addMediaBtn = findButton("Add Media") || findButton("add_2Create")
                    if (addMediaBtn) { addMediaBtn.click(); await sleep(1000) }

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
                        } catch (e) { console.error("Upload error", e) }
                    }

                    for (let i = 0; i < 30; i++) {
                        await sleep(1000)
                        const currentImgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="media.getMediaUrlRedirect"]'))
                        const uploaded = currentImgs.find(img => !beforeImgs.includes(img.src))
                        if (uploaded) return uploaded.src
                    }
                    return null
                }

                const startSrc = await uploadAndWait(startImgUrl)
                const endSrc = await uploadAndWait(endImgUrl)

                const selectFrame = async (buttonText: string, src: string | null) => {
                    if (!src) return
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
                                if (row) { row.click(); await sleep(500) }
                            }
                        }
                    }
                }

                await selectFrame("Start", startSrc)
                await selectFrame("End", endSrc)

                const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement
                if (editor) {
                    editor.focus()
                    document.execCommand('selectAll', false)
                    document.execCommand('delete', false)
                    document.execCommand('insertText', false, textPrompt)
                    await sleep(1000)
                }

                const createBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes("Create"))
                const createBtn = createBtns[createBtns.length - 1]
                if (createBtn) createBtn.click()

                const existingVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video')).map(v => v.src)
                let generatedUrl = ""
                for (let i = 0; i < 150; i++) {
                    await sleep(2000)
                    const currentVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
                    const newVid = currentVideos.find(v => v.src && !existingVideos.includes(v.src))
                    if (newVid) { generatedUrl = newVid.src; break }
                }
                return generatedUrl
            },
            args: [beforeUrl, afterUrl, prompt]
        })

        const url = results[0]?.result
        if (!url) throw new Error("Could not find generated video URL")
        setTimeout(() => chrome.tabs.remove(tabId), 1000)
        return url as string
    } catch (err) {
        chrome.tabs.remove(tabId).catch(() => {})
        throw err
    }
}
