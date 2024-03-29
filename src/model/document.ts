
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

export interface AssociationDocument<T> extends DocumentBase<T, 'association'> {
    owner?: string
    timelines: string[]
}

export type ProfileDocument<T> = DocumentBase<T, 'profile'>

export interface DeleteBody {
    target: string
}

export type DeleteDocument = DocumentBase<DeleteBody, 'delete'>

export type ExtensionDocument<T> = DocumentBase<T, 'extension'>

export interface TimelineDocument<T> extends DocumentBase<T, 'timeline'> {
    indexable: boolean
    domainOwned: boolean
}

