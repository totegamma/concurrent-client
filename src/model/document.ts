
export interface DocumentBase<T, S> {
    id?: string
    signer: string
    type: S
    schema?: string
    keyID?: string
    body?: T
    meta?: any
    signedAt: Date
}


export interface AffiliationDocument extends DocumentBase<undefined, 'affiliation'> {
    domain: string
}

export interface MessageDocument<T> extends DocumentBase<T, 'message'> {
    timelines: string[]
}

export interface AssociationDocument<T> extends DocumentBase<T, 'association'> {
    target: string
    owner: string
    variant: string
    timelines: string[]
}

export type ProfileDocument<T> = DocumentBase<T, 'profile'>


export interface DeleteDocument extends DocumentBase<undefined, 'delete'> {
    target: string
}

export type ExtensionDocument<T> = DocumentBase<T, 'extension'>

export interface TimelineDocument<T> extends DocumentBase<T, 'timeline'> {
    indexable: boolean
    domainOwned: boolean
}

