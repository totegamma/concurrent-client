
export const fetchWithTimeout = async (
    domain: string,
    path: string,
    init: RequestInit,
    timeoutMs = 5 * 1000
): Promise<Response> => {
    const controller = new AbortController()
    const clientTimeout = setTimeout(() => {
        controller.abort()
    }, timeoutMs)

    const url = domain ? `https://${domain}${path}` : path

    try {
        const reqConfig: RequestInit = { ...init, signal: controller.signal }
        return await fetch(url, reqConfig)
    } catch (e: unknown) {
        if (e instanceof Error) {
            return await Promise.reject(new Error(`${e.name}: ${e.message}`))
        } else {
            return await Promise.reject(new Error('fetch failed with unknown error'))
        }
    } finally {
        clearTimeout(clientTimeout)
    }
}

export const IsCCID = (str: string): boolean => {
    return str.startsWith('con1') && !str.includes('.') && str.length === 42
}

