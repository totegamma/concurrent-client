import { ec as Ec } from 'elliptic'
import { v4 as uuidv4 } from 'uuid'
import { keccak256, recoverAddress } from 'ethers'
import { Mnemonic, randomBytes, HDNodeWallet } from 'ethers'
import { LangJa } from './lang-ja'

import { Secp256k1 } from "@cosmjs/crypto";
import { toBech32 } from "@cosmjs/encoding";
import { rawSecp256k1PubkeyToRawAddress } from "@cosmjs/amino";

export interface Identity {
    mnemonic_ja: string
    mnemonic_en: string
    privateKey: string
    publicKey: string
    CCID: string
}

export const generateIdentity = (): Identity => {
    const entrophy = randomBytes(16)
    const mnemonicJa = Mnemonic.fromEntropy(entrophy, null, LangJa.wordlist())
    const mnemonicEn = Mnemonic.fromEntropy(entrophy, null)
    const wallet = HDNodeWallet.fromPhrase(mnemonicEn.phrase)
    const CCID = 'CC' + wallet.address.slice(2)
    const privateKey = wallet.privateKey.slice(2)
    const publicKey = wallet.publicKey.slice(2)

    return {
        mnemonic_ja: mnemonicJa.phrase.normalize().replaceAll('　', ' '),
        mnemonic_en: mnemonicEn.phrase,
        privateKey,
        publicKey,
        CCID
    }
}

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
        let privatekey = keyPair.getPrivate().toString('hex')
        let publickey = keyPair.getPublic().encode('hex', false)

        privatekey = '0'.repeat(64 - privatekey.length) + privatekey
        console.log('priv', privatekey)

        return {
            privatekey,
            publickey,
        }
    } catch (error) {
        return null
    }
}

export interface SubKey {
    keypair: KeyPair
    domain: string
    ccid: string
    ckid: string
}

export const LoadSubKey = (secret: string): SubKey | null => {
    try  {
        // format: concurrent-subkey <privatekey> <ccid>@<domain>
        const reg = /concurrent-subkey\s+([0-9a-f]{64})\s+([^@]+)@([^\s]+)/
        const match = secret.match(reg)
        if (!match) return null
        const privatekey = match[1]
        const ccid = match[2]
        const domain = match[3]

        const keypair = LoadKey(privatekey)
        if (!keypair) return null

        const ckid = ComputeCKID(keypair.publickey)

        return {
            keypair,
            domain,
            ccid,
            ckid
        }

    } catch (error) {
        return null
    }
}

export const ComputeCCID = (publickey: string): string => {
    const bytes = parseHexString(publickey)
    let compressedPubkey = Secp256k1.compressPubkey(bytes)
    let address = toBech32('con', rawSecp256k1PubkeyToRawAddress(compressedPubkey))
    return address
}

export const ComputeCKID = (publickey: string): string => {
    const bytes = parseHexString(publickey)
    let compressedPubkey = Secp256k1.compressPubkey(bytes)
    let address = toBech32('cck', rawSecp256k1PubkeyToRawAddress(compressedPubkey))
    return address
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

export const parseJWT = (jwt: string): JwtPayload => {
    const split = jwt.split('.')
    if (split.length !== 3) return {}
    const encoded = split[1]
    const payload = atob(
        encoded.replace('-', '+').replace('_', '/') + '=='.slice((2 - encoded.length * 3) & 3)
    )
    try {
        return JSON.parse(payload)
    } catch (e) {
        console.log(e)
    }
    return {}
}

export const checkJwtIsValid = (jwt: string): boolean => {
    const claims = parseJWT(jwt)
    if (!claims) return false
    if (!claims.exp) return true
    const exp = parseInt(claims.exp)
    const now = Math.floor(new Date().getTime() / 1000)
    return now < exp
}

function toHexString(byteArray: Uint8Array | number[]): string {
    return Array.from(byteArray, function (byte) {
        return ('0' + (byte & 0xff).toString(16)).slice(-2)
    }).join('')
}

function parseHexString(hexString: string): Uint8Array {
    return new Uint8Array((hexString.match(/.{1,2}/g) ?? []).map((byte) => parseInt(byte, 16)))
}

export interface JwtPayload {
    iss?: string // 発行者
    sub?: string // 用途
    aud?: string // 想定利用者
    exp?: string // 失効時刻
    iat?: string // 発行時刻
    jti?: string // JWT ID
    tag?: string // comma separated list of tags
    scp?: string // semicomma separated list of scopes
    prn?: string // principal
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
        exp: Math.floor((new Date().getTime() + 5 * 60 * 1000) / 1000).toString(),
        ...claim
    })
    console.log(payload)
    return SignJWT(payload, key)
}

