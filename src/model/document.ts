
export interface DocumentBase<T, S> {
    id?: string
    signer: string
    type: S
    schema?: string
    keyID?: string
    body: T
    meta?: any
    signedAt: Date
}


export interface AffiliationBody {
    domain: string
}
export type AffiliationDocument = DocumentBase<AffiliationBody, 'affiliation'>

export interface MessageDocument<T> extends DocumentBase<T, 'message'> {
    timelines: string[]
}





