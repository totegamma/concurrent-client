
export const fetchWithTimeout = async (
    domain: string,
    path: string,
    init: RequestInit,
    timeoutMs = 3 * 1000
): Promise<Response> => {
    const controller = new AbortController()
    const clientTimeout = setTimeout(() => {
        controller.abort()
    }, timeoutMs)

    const url = domain ? `https://${domain}${path}` : path

    try {
        const reqConfig: RequestInit = { ...init, signal: controller.signal }
        const res = await fetch(url, reqConfig)
        if (!res.ok) {
            const description = `${res.status}: ${url as string} traceID: ${res.headers.get('trace-id') ?? 'N/A'}`
            return await Promise.reject(new Error(description))
        }

        return res
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

