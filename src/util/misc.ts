
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

    const reqConfig: RequestInit = { ...init, signal: controller.signal }
    return await fetch(url, reqConfig)
        .then((res) => {
            return res
        })
        .finally(() => {
            clearTimeout(clientTimeout)
        })
}

export const IsCCID = (str: string): boolean => {
    return str.startsWith('con1') && !str.includes('.') && str.length === 42
}

