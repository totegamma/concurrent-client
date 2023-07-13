import { ec as Ec } from 'elliptic'
import { keccak256, recoverAddress } from 'ethers'

export const validateSignature = (body: string, signature: string, expectedAuthor: string): boolean => {
    const messageHash = keccak256(new TextEncoder().encode(body))
    const recovered = recoverAddress(messageHash, '0x' + signature)
    return recovered.slice(2) === expectedAuthor.slice(2)
}

export const Sign = (privatekey: string, payload: string): string => {
    const ellipsis = new Ec('secp256k1')
    const keyPair = ellipsis.keyFromPrivate(privatekey)
    const messageHash = keccak256(new TextEncoder().encode(payload)).slice(2)
    const signature = keyPair.sign(messageHash, 'hex', { canonical: true })
    const r = toHexString(signature.r.toArray())
    const s = toHexString(signature.s.toArray())
    const rpad = '0'.repeat(64 - r.length) + r
    const spad = '0'.repeat(64 - s.length) + s
    const v = signature.recoveryParam === 0 ? '00' : '01'
    return rpad + spad + v
}

const makeUrlSafe = (input: string): string => {
    return input.replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
}

const btoa = (input: string): string => {
    // use window.btoa if we are in the browser
    if (typeof window !== 'undefined') {
        return window.btoa(input)
    }
    // use Buffer if we are in node
    return Buffer.from(input, 'binary').toString('base64')
}

const atob = (input: string): string => {
    // use window.atob if we are in the browser
    if (typeof window !== 'undefined') {
        return window.atob(input)
    }
    // use Buffer if we are in node
    return Buffer.from(input, 'base64').toString('binary')
}

export const SignJWT = (payload: string, privatekey: string): string => {
    const header = JSON.stringify({ alg: 'ECRECOVER', typ: 'JWT' })
    const body = makeUrlSafe(btoa(header) + '.' + btoa(payload))
    const bodyHash = keccak256(new TextEncoder().encode(body)).slice(2)
    const ellipsis = new Ec('secp256k1')
    const keyPair = ellipsis.keyFromPrivate(privatekey)
    const signature = keyPair.sign(bodyHash, 'hex', { canonical: true })
    const base64 = makeUrlSafe(
        btoa(
            String.fromCharCode.apply(null, [
                ...signature.r.toArray(),
                ...signature.s.toArray(),
                signature.recoveryParam ?? 0
            ])
        )
    )
    return body + '.' + base64
}

export const checkJwtIsValid = (jwt: string): boolean => {
    const split = jwt.split('.')
    if (split.length !== 3) return false
    const encoded = split[1]
    const payload = atob(
        encoded.replace('-', '+').replace('_', '/') + '=='.slice((2 - encoded.length * 3) & 3)
    )
    try {
        const claims = JSON.parse(payload)
        const nbf = parseInt(claims.nbf)
        const exp = parseInt(claims.exp)
        const now = Math.floor(new Date().getTime() / 1000)

        return nbf < now && now < exp
    } catch (e) {
        console.log(e)
    }
    return false
}

function toHexString(byteArray: Uint8Array | number[]): string {
    return Array.from(byteArray, function (byte) {
        return ('0' + (byte & 0xff).toString(16)).slice(-2)
    }).join('')
}
