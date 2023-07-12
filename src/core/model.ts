
export interface Entity {
    ccaddr: string
    role: string
    host: string
    cdate: string
}

export interface SignedObject<T> {
    signer: string
    type: string
    schema: string
    body: T
    meta: any
    signedAt: string
    target?: string
}

export interface Association<T> {
    author: string
    cdate: string
    id: string
    payload: T
    schema: string
    signature: string
    targetID: string
    targetType: string
}

export interface MessagePostRequest {
    signedObject: string
    signature: string
    streams: string[]
}

export interface Message<T> {
    associations: Array<Association<any>>
    author: string
    cdate: string
    id: string
    payload: SignedObject<T>
    rawpayload: string
    schema: string
    signature: string
    streams: string[]
}

export interface Character<T> {
    associations: Array<Association<any>>
    author: string
    schema: string
    id: string
    payload: SignedObject<T>
    signature: string
    cdate: string
}

export interface Host {
    fqdn: string
    ccaddr: string
    role: string
    pubkey: string
    cdate: Date
}

export interface Stream<T> {
    id: string
    author: string
    maintainer: string[]
    writer: string[]
    reader: string[]
    schema: string
    payload: SignedObject<T>
    signature: string
    cdate: string
}

