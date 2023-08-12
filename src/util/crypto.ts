import { ec as Ec } from 'elliptic'
import { v4 as uuidv4 } from 'uuid'
import { computeAddress, keccak256, recoverAddress } from 'ethers'

export interface KeyPair {
    privatekey: string
    publickey: string
}

export const validateSignature = (body: string, signature: string, expectedAuthor: string): boolean => {
    const messageHash = keccak256(new TextEncoder().encode(body))
    const recovered = recoverAddress(messageHash, '0x' + signature)
    return recovered.slice(2) === expectedAuthor.slice(2)
}

export const LoadKey = (privateKey: string): KeyPair | null => {
    try {
        const ellipsis = new Ec('secp256k1')
        const keyPair = ellipsis.keyFromPrivate(privateKey)
        if (!keyPair.getPrivate()) return null
        const privatekey = keyPair.getPrivate().toString('hex')
        const publickey = keyPair.getPublic().encode('hex', false)
        return {
            privatekey,
            publickey,
        }
    } catch (error) {
        return null
    }
}

export const CommputeCCID = (publickey: string): string => {
    const ethAddress = computeAddress('0x' + publickey)
    const ccid = 'CC' + ethAddress.slice(2)
    return ccid
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
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(input, 'binary').toString('base64')
    }

    console.error('no way to encode base64')
    return ''
}

const atob = (input: string): string => {
    // use window.atob if we are in the browser
    if (typeof window !== 'undefined') {
        return window.atob(input)
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(input, 'base64').toString('binary')
    }

    console.error('no way to decode base64')
    return ''
}

export const SignJWT = (payload: string, privatekey: string): string => {
    const header = JSON.stringify({ alg: 'ECRECOVER', typ: 'JWT' })
    const body = makeUrlSafe(btoa(header) + '.' + btoa(payload))
    const bodyHash = keccak256(new TextEncoder().encode(body)).slice(2)
    const ellipsis = new Ec('secp256k1')
    const keyPair = ellipsis.keyFromPrivate(privatekey)
    const signature = keyPair.sign(bodyHash, 'hex', { canonical: true })

    const r_raw = signature.r.toArray()
    const r_padded = new Uint8Array(32)
    r_padded.set(r_raw, 32 - r_raw.length)

    const s_raw = signature.s.toArray()
    const s_padded = new Uint8Array(32)
    s_padded.set(s_raw, 32 - s_raw.length)

    const base64 = makeUrlSafe(
        btoa(
            String.fromCharCode.apply(null, [
                ...r_padded,
                ...s_padded,
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

interface JwtPayload {
    iss?: string // 発行者
    sub?: string // 用途
    aud?: string // 想定利用者
    exp?: string // 失効時刻
    nbf?: string // 有効になる時刻
    iat?: string // 発行時刻
    jti?: string // JWT ID
}

export const IsValid256k1PrivateKey = (key: string): boolean => {
    if (!/^[0-9a-f]{64}$/i.test(key)) return false
    const privateKey = BigInt(`0x${key}`)
    const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
    return privateKey > BigInt(0) && privateKey < n
}

export const IssueJWT = (key: string, claim?: JwtPayload): string => {
    if (!IsValid256k1PrivateKey(key)) return ''
    const payload = JSON.stringify({
        jti: uuidv4(),
        iat: Math.floor(new Date().getTime() / 1000).toString(),
        nbf: Math.floor((new Date().getTime() - 5 * 60 * 1000) / 1000).toString(),
        exp: Math.floor((new Date().getTime() + 5 * 60 * 1000) / 1000).toString(),
        ...claim
    })
    console.log(payload)
    return SignJWT(payload, key)
}

