/// <reference types="chrome" />

export interface ScriptResult {
    url: string
    logs: string[]
    createClick?: { x: number; y: number }
    existingVideos?: string[]
}

export type LogFn = (msg: string) => void
export type ClickPoint = { x: number; y: number }

interface ChromeExtensionBridge {
    debugger: {
        click: (payload: { tabId: number } & ClickPoint) => Promise<unknown>
    }
    fetchDataUrl: (url: string) => Promise<{ dataUrl: string; type: string; size: number }>
}

export const FLOW_URL = "https://labs.google/fx/tools/flow"
export const TIKTOK_STUDIO_UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video"
export const INITIAL_PAGE_LOAD_MS = 8000
const CLOSE_TAB_DELAY_MS = 1000

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function createActiveTab(url: string, errorMessage: string): Promise<number> {
    const tab = await chrome.tabs.create({ url, active: true }) as chrome.tabs.Tab
    if (!tab.id) throw new Error(errorMessage)
    return tab.id
}

export function chromeExtensionBridge(): ChromeExtensionBridge {
    return chrome as unknown as ChromeExtensionBridge
}

export async function trustedClick(tabId: number, point: ClickPoint): Promise<void> {
    await chromeExtensionBridge().debugger.click({ tabId, ...point })
}

export function logScriptResult(prefix: string, result: { logs?: string[] } | undefined, log: LogFn): void {
    for (const line of result?.logs ?? []) {
        log(`[${prefix}] ${line}`)
    }
}

export function closeTabSoon(tabId: number): void {
    setTimeout(() => chrome.tabs.remove(tabId), CLOSE_TAB_DELAY_MS)
}
