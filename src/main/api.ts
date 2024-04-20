
import { Entity, Message, Character, Association, Timeline, Profile, CCID, Domain, FQDN, Collection, CollectionID, CollectionItem, Ack, Key, TimelineID, TimelineItem, Subscription } from '../model/core'
import { fetchWithTimeout, isCCID } from '../util/misc'
import { Sign, IssueJWT, checkJwtIsValid, parseJWT, JwtPayload } from '../util/crypto'
import { Schema } from '../schemas'
import { CCDocument } from '..'

const apiPath = '/api/v1'

class DomainOfflineError extends Error {
    constructor(domain: string) {
        super(`domain ${domain} is offline`)
    }
}

class JWTExpiredError extends Error {
    constructor() {
        super('JWT expired')
    }
}

class InvalidKeyError extends Error {
    constructor() {
        super('Invalid key')
    }
}

export class Api {
    host: string

    ccid?: string
    ckid?: string
    privatekey?: string
    token?: string
    passports: Record<string, string> = {}

    client: string

    addressCache: Record<string, Promise<string> | null | undefined> = {}
    entityCache: Record<string, Promise<Entity> | null | undefined> = {}
    messageCache: Record<string, Promise<Message<any>> | null | undefined> = {}
    characterCache: Record<string, Promise<Character<any>[]> | null | undefined> = {}
    associationCache: Record<string, Promise<Association<any>> | null | undefined> = {}
    streamCache: Record<string, Promise<Timeline<any>> | null | undefined> = {}
    domainCache: Record<string, Promise<Domain> | null | undefined> = {}

    constructor(conf: {host: string, ccid?: string, privatekey?: string, client?: string, token?: string, ckid?: string}) {
        this.host = conf.host
        this.ccid = conf.ccid
        this.ckid = conf.ckid
        this.privatekey = conf.privatekey
        this.client = conf.client || 'N/A'
        this.token = conf.token
        console.log('oOoOoOoOoO API SERVICE CREATED OoOoOoOoOo')
    }

    async getPassport(remote: string): Promise<string> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        return await this.fetchWithCredential(this.host, `${apiPath}/auth/passport/${remote}`, {
            method: 'GET',
            headers: {}
        })
            .then(async (res) => await res.json())
            .then((data) => {
                this.passports[remote] = data.content
                return data.content
            })
    }

    generateApiToken(): string {

        if (!this.ccid || !this.privatekey) throw new InvalidKeyError()

        const token = IssueJWT(this.privatekey, {
            aud: this.host,
            iss: this.ckid || this.ccid,
            sub: 'concrnt',
        })

        this.token = token

        return token
    }

    async commit<T>(obj: any, host: string = ''): Promise<T> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        if (this.ckid) {
            obj.keyID = this.ckid
        }

        const document = JSON.stringify(obj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        return await this.fetchWithCredential(
            host || this.host,
            `${apiPath}/commit`,
            requestOptions
        )
            .then(async (res) => await res.json())
            .then((data) => {
                return data.content
            })
    }

    async fetchWithOnlineCheck(domain: string, path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
        const host = await this.getDomain(domain)
        if (!host) return Promise.reject(new DomainOfflineError(domain))
        return await fetchWithTimeout(domain, `${apiPath}${path}`, init, timeoutMs)
    }

    async fetchWithCredential(domain: string, path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {

        let credential = ''

        if (domain === this.host) {
            credential = this.token || ''
            if (!credential || !checkJwtIsValid(credential)) {
                if (!this.privatekey) return Promise.reject(new JWTExpiredError())
                credential = this.generateApiToken()
            }
        } else {
            credential = this.passports[domain]
            if (!credential || !checkJwtIsValid(credential)) {
                if (!this.privatekey) return Promise.reject(new JWTExpiredError())
                credential = await this.getPassport(domain)
            }
        }
        const requestInit = {
            ...init,
            headers: {
                ...init.headers,
                authorization: 'Bearer ' + credential
            }
        }
        return await fetchWithTimeout(domain, path, requestInit, timeoutMs)
    }

    async resolveAddress(ccid: string, hint?: string): Promise<string | null | undefined> {
        const entity = await this.getEntity(ccid, hint)
        if (!entity) {
            console.log(`entity not found: ${ccid}`)
            return null
        }
        return entity.domain
    }


    // Message
    async createMessage<T>(schema: Schema, body: T, timelines: TimelineID[]): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        const documentObj: CCDocument.Message<T> = {
            signer: this.ccid,
            type: 'message',
            schema,
            body,
            meta: {
                client: this.client
            },
            timelines,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const request = {
            document,
            signature,
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/commit`, requestOptions)

        return await res.json()
    }

    async getMessage(id: string, host: string = ''): Promise<Message<any> | null | undefined> {

        if (this.messageCache[id]) {
            const value = await this.messageCache[id]
            if (value !== undefined) return value
        }

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        const messageHost = host || this.host
        if ((this.token || this.privatekey) && this.privatekey !== "8c215bedacf0888470fd2567d03a813f4ae926be4a2cd587979809b629d70592") { // Well-known Guest key
            this.messageCache[id] = this.fetchWithCredential(messageHost, `${apiPath}/message/${id}`, requestOptions).then(async (res) => {

                if (!res.ok) {
                    if (res.status === 404) return null 
                    return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
                }
                const data = await res.json()
                if (data.status != 'ok') {
                    return undefined
                }
                const message = data.content
                message._document = message.document
                message.document = JSON.parse(message.document)

                message.ownAssociations = message.ownAssociations?.map((a: any) => {
                    a._document = a.document
                    a.document = JSON.parse(a.document)
                    return a
                }) ?? []

                return message
            })
        } else {
            this.messageCache[id] = this.fetchWithOnlineCheck(messageHost, `/message/${id}`, requestOptions).then(async (res) => {

                if (!res.ok) {
                    if (res.status === 404) return null 
                    return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
                }
                const data = await res.json()
                if (data.status != 'ok') {
                    return undefined
                }
                const message = data.content
                message._document = message.document
                message.document = JSON.parse(message.document)

                message.ownAssociations = message.ownAssociations?.map((a: any) => {
                    a._document = a.document
                    a.document = JSON.parse(a.document)
                    return a
                }) ?? []

                return message
            })
        }
        return await this.messageCache[id]
    }

    async getMessageWithAuthor(messageId: string, author: string, hint?: string): Promise<Message<any> | null | undefined> {
        const domain = await this.resolveAddress(author, hint)
        if (!domain) throw new Error('domain not found')
        return await this.getMessage(messageId, domain || this.host)
    }

    async getMessageAssociationsByTarget<T>(target: string, targetAuthor: string, filter: {schema?: string, variant?: string} = {}): Promise<Association<T>[]> {
        let requestPath = `/message/${target}/associations`
        if (filter.schema) requestPath += `?schema=${encodeURIComponent(filter.schema)}`
        if (filter.variant) requestPath += `&variant=${encodeURIComponent(filter.variant)}`

        const domain = await this.resolveAddress(targetAuthor)
        if (!domain) throw new Error('domain not found')

        const resp = await this.fetchWithOnlineCheck(domain || this.host, requestPath, {
            method: 'GET',
            headers: {}
        })

        let data = (await resp.json()).content
        data = data?.map((a: any) => {
            a._document = a.document
            a.document = JSON.parse(a.document)
            return a
        }) ?? []

        return data
    }

    async getMessageAssociationCountsByTarget(target: string, targetAuthor: string, groupby: {schema?: string} = {}): Promise<Record<string, number>> {
        let requestPath = `/message/${target}/associationcounts`
        if (groupby.schema) requestPath += `?schema=${encodeURIComponent(groupby.schema)}`

        const domain = await this.resolveAddress(targetAuthor)
        if (!domain) throw new Error('domain not found')

        const resp = await this.fetchWithOnlineCheck(domain, requestPath, {
            method: 'GET',
            headers: {}
        })

        let data = (await resp.json()).content
        return data
    }

    async deleteMessage(target: string, host: string = ''): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const targetHost = !host ? this.host : host

        const documentObj: CCDocument.Delete = {
            signer: this.ccid,
            type: 'delete',
            target,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/commit`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    cacheMessage(message: Message<any>): void {
        this.messageCache[message.id] = Promise.resolve(message)
    }

    invalidateMessage(target: string): void {
        delete this.messageCache[target]
    }

    // Association
    async createAssociation<T>(
        schema: Schema,
        body: T,
        target: string,
        targetAuthor: CCID,
        timelines: TimelineID[],
        variant: string = ''
    ): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const targetHost = await this.resolveAddress(targetAuthor)
        if (!targetHost) throw new Error('domain not found')

        const documentObj: CCDocument.Association<T> = {
            signer: this.ccid,
            type: 'association',
            schema,
            body,
            meta: {
                client: this.client
            },
            target,
            owner: targetAuthor,
            variant,
            timelines,
            signedAt: new Date(),
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature,
            })
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/commit`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    async deleteAssociation(
        target: string,
        targetAuthor: CCID
    ): Promise<{ status: string; content: Association<any> }> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const targetHost = await this.resolveAddress(targetAuthor)
        if (!targetHost) throw new Error('domain not found')

        const documentObj: CCDocument.Delete = {
            signer: this.ccid,
            type: 'delete',
            target,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/commit`, requestOptions)
            .then(async (res) => await res.json())
            .then((data: { status: string; content: Association<any> }) => {
                return data
            })
    }

    cacheAssociation(association: Association<any>): void {
        this.associationCache[association.id] = Promise.resolve(association)
    }

    invalidateAssociation(target: string): void {
        delete this.associationCache[target]
    }

    async getAssociation(id: string, host: string = ''): Promise<Association<any> | null | undefined> {
        if (this.associationCache[id]) {
            const value = await this.associationCache[id]
            if (value !== undefined) return value
        }
        const associationHost = !host ? this.host : host
        this.associationCache[id] = this.fetchWithOnlineCheck(associationHost, `/association/${id}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) return null
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = await res.json()
            if (!data.content) {
                return undefined
            }
            const association = data.content
            association._document = association.document
            association.document = JSON.parse(association.document)
            this.associationCache[id] = association
            return association
        })
        return await this.associationCache[id]
    }

    async getAssociationWithOwner(associationId: string, owner: string): Promise<Association<any> | null | undefined> {
        const targetHost = await this.resolveAddress(owner)
        if (!targetHost) throw new Error('domain not found')
        return await this.getAssociation(associationId, targetHost)
    }

    // Profile

    async getProfileBySemanticID<T>(semanticID: string, owner: string): Promise<Profile<T> | null | undefined> {
        const targetHost = await this.resolveAddress(owner)
        if (!targetHost) throw new Error('domain not found')
        return await this.fetchWithOnlineCheck(targetHost, `/profile/${owner}/${semanticID}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const data = await res.json()
            const profile = data.content
            if (!profile) {
                return null
            }
            profile._document = profile.document
            profile.document = JSON.parse(profile.document)
            return profile
        })
    }

    async upsertProfile<T>(schema: Schema, body: T, opts: {id?: string, semanticID?: string} = {id: undefined, semanticID: undefined}): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const documentObj: CCDocument.Profile<T> = {
            id: opts.id,
            semanticID: opts.semanticID,
            signer: this.ccid,
            type: 'profile',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const request = {
            document,
            signature
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/commit`, requestOptions)

        return await res.json()
    }


    // Character
    async upsertCharacter<T>(schema: Schema, body: T, id?: string): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const signObject: CCDocument.Profile<T> = {
            signer: this.ccid,
            type: 'profile',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date()
        }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const request = {
            signedObject,
            signature,
            id
        }

        const requestOptions = {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        return await this.fetchWithCredential(this.host, `${apiPath}/character`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                const character = data.content
                character._document = character.document
                character.document = JSON.parse(character.document)
                return character
            })
    }

    /**
     * @deprecated
     */
    async getCharacter<T>(author: string = "", schema: string = "", domain?: string): Promise<Character<T>[] | null | undefined> {
        if (!author && !schema) return Promise.reject(new Error('author or schema is required'))
        if (this.characterCache[author + schema]) {
            const value = await this.characterCache[author + schema]
            if (value !== undefined) return value
        }
        const targetHost = domain ?? await this.resolveAddress(author)
        if (!targetHost) throw new Error('domain not found')
        this.characterCache[author + schema] = this.fetchWithOnlineCheck(
            targetHost,
            `/characters?author=${author}&schema=${encodeURIComponent(schema)}`,
            {
                method: 'GET',
                headers: {}
            }
        ).then(async (res) => {
            const data = await res.json()
            if (data.content.length === 0) {
                return null
            }
            const characters = data.content
            characters.forEach((character: any) => {
                character._document = character.document
                character.document = JSON.parse(character.document)
            })
            return characters
        })
        return await this.characterCache[author + schema]
    }

    async getCharacters<T>(query: {author?: string, schema?: string, domain?: string}): Promise<Character<T>[] | null | undefined> {
        if (!query.author && !query.schema) return Promise.reject(new Error('author or schema is required'))
        const author = query.author ?? ''
        const schema = query.schema ?? ''
        const cacheKey = author + schema + (query.domain ?? '')
        const targetHost = query.domain ?? (query.author && await this.resolveAddress(query.author)) ?? this.host
        if (this.characterCache[cacheKey]) {
            const value = await this.characterCache[cacheKey]
            if (value !== undefined) return value
        }
        if (!targetHost) throw new Error('domain not found')

        const queries = []
        if (query.author) queries.push(`author=${query.author}`)
        if (query.schema) queries.push(`schema=${encodeURIComponent(query.schema)}`)

        this.characterCache[cacheKey] = this.fetchWithOnlineCheck(
            targetHost,
            `/characters?${queries.join('&')}`,
            {
                method: 'GET',
                headers: {}
            }
        ).then(async (res) => {
            const data = await res.json()
            if (data.content.length === 0) {
                return null
            }
            const characters = data.content
            characters.forEach((character: any) => {
                character._document = character.document
                character.document = JSON.parse(character.document)
            })
            return characters
        })
        return await this.characterCache[cacheKey]
    }

    async getCharacterByID<T>(id: string, author: string): Promise<Character<T> | null | undefined> {
        const targetHost = await this.resolveAddress(author)
        if (!targetHost) throw new Error('domain not found')
        const request = this.fetchWithOnlineCheck(targetHost, `/character/${id}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const data = await res.json()
            if (!data.content) {
                return null
            }
            const character = data.content
            character._document = character.document
            character.document = JSON.parse(character.document)
            return character
        })
        return request
    }

    async deleteCharacter(id: string): Promise<any> {
        const requestOptions = {
            method: 'DELETE'
        }

        return await this.fetchWithCredential(this.host, `${apiPath}/character/${id}`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    invalidateCharacter(author: string = "", schema: string = "", domain = ""): void {
        delete this.characterCache[author + schema + domain]
    }

    invalidateCharacterByID(id: string): void {
        Object.keys(this.characterCache).forEach(async (key) => {
            for (const character of (await this.characterCache[key]) ?? []) {
                if (character.id === id) {
                    delete this.characterCache[key]
                }
            }
        })
    }

    // Timeline
    async upsertTimeline<T>(
        schema: string,
        body: T,
        { id = undefined, semanticID = undefined, indexable = true, domainOwned = true }: { id?: string, semanticID?: string, indexable?: boolean, domainOwned?: boolean } = {}
    ): Promise<Timeline<T>> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        const documentObj: CCDocument.Timeline<T> = {
            id,
            signer: this.ccid,
            type: 'timeline',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date(),
            indexable,
            semanticID,
            domainOwned
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        return await this.fetchWithCredential(this.host, `${apiPath}/commit`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data.content
            })
    }

    async deleteTimeline(target: string, host: string = ''): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const targetHost = !host ? this.host : host

        const documentObj: CCDocument.Delete = {
            signer: this.ccid,
            type: 'delete',
            target,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/commit`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    async removeFromStream(elementID: string, stream: string): Promise<any> {
        const requestOptions = {
            method: 'DELETE'
        }

        return await this.fetchWithCredential(
            this.host,
            `${apiPath}/stream/${stream}/${elementID}`,
            requestOptions
        ).then(async (res) => await res.json())
    }

    async getTimelineListBySchema<T>(schema: string, remote?: FQDN): Promise<Array<Timeline<T>>> {
        schema = encodeURIComponent(schema)
        return await fetchWithTimeout(remote ?? this.host, `${apiPath}/timelines?schema=${schema}`, {}).then(
            async (data) => {
                return await data.json().then((data) => {
                    return data.content.map((e: any) => {
                        return { ...e, document: JSON.parse(e.document) }
                    })
                })
            }
        )
    }

    async getTimeline(id: string): Promise<Timeline<any> | null | undefined> {
        if (this.streamCache[id]) {
            const value = await this.streamCache[id]
            if (value !== undefined) return value
        }
        let host = id.split('@')[1] ?? this.host

        if (isCCID(host)) {
            const domain = await this.resolveAddress(host)
            if (!domain) throw new Error('domain not found: ' + host)
            host = domain
        }

        this.streamCache[id] = this.fetchWithOnlineCheck(host, `/timeline/${id}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) return null
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = (await res.json()).content
            if (!data.document) {
                return undefined
            }
            const stream = data
            stream.id = id
            stream._document = stream.document
            stream.document = JSON.parse(stream.document)
            this.streamCache[id] = stream
            return stream
        })
        return await this.streamCache[id]
    }

    async getTimelineRecent(streams: string[]): Promise<TimelineItem[]> {

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        let result: TimelineItem[] = []

        try {
            const response = await this.fetchWithOnlineCheck(
                this.host,
                `/timelines/recent?timelines=${streams}`,
                requestOptions
            ).then(async (res) => {
                const data = await res.json()
                const formed = data.content.map((e: any) => {
                    e.cdate = new Date(e.cdate)
                    return e
                })
                return formed
            })
            result = [...result, ...response]
        } catch (e) {
            console.warn(e)
        }

        return result
    }

    async getTimelineRanged(streams: string[], param: {until?: Date, since?: Date}): Promise<TimelineItem[]> {

        console.log('readStreamRanged', streams, param)

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        const sinceQuery = !param.since ? '' : `&since=${Math.floor(param.since.getTime()/1000)}`
        const untilQuery = !param.until ? '' : `&until=${Math.ceil(param.until.getTime()/1000)}`

        let result: TimelineItem[] = []
        try {
            const response = await this.fetchWithOnlineCheck(
                this.host,
                `/timelines/range?timelines=${streams.join(',')}${sinceQuery}${untilQuery}`,
                requestOptions
            ).then(async (res) => {
                const data = await res.json()
                const formed = data.content.map((e: any) => {
                    e.cdate = new Date(e.cdate)
                    return e
                })
                return formed
            })
            result = [...result, ...response]
        } catch (e) {
            console.warn(e)
        }

        return result
    }

    // Subscription
    async upsertSubscription<T>(
        schema: string,
        body: T,
        { id = undefined, semanticID = undefined, indexable = true, domainOwned = true }: { id?: string, semanticID?: string, indexable?: boolean, domainOwned?: boolean } = {}
    ): Promise<Timeline<T>> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const doc: CCDocument.Subscription<T> = {
            id,
            signer: this.ccid,
            type: 'subscription',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date(),
            indexable,
            semanticID,
            domainOwned
        }

        return await this.commit(doc)
    }

    async subscribe(target: string, subscription: string): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        const document: CCDocument.Subscribe = {
            signer: this.ccid,
            type: 'subscribe',
            target,
            subscription,
            signedAt: new Date()
        }

        return await this.commit(document)
    }

    async unsubscribe(target: string, subscription: string): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        const document: CCDocument.Unsubscribe = {
            signer: this.ccid,
            type: 'unsubscribe',
            target,
            subscription,
            signedAt: new Date()
        }

        return await this.commit(document)
    }

    async getSubscription(id: string): Promise<Subscription<any> | null | undefined> {
        const key = id.split('@')[0]
        let host = id.split('@')[1] ?? this.host

        if (isCCID(host)) {
            const domain = await this.resolveAddress(host)
            if (!domain) throw new Error('domain not found')
            host = domain
        }

        return await this.fetchWithOnlineCheck(host, `/subscription/${key}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const data = await res.json()
            if (!data.content) {
                return null
            }
            const subscription = data.content
            subscription._document = subscription.document
            subscription.document = JSON.parse(subscription.document)
            return subscription
        })
    }


    async getOwnSubscriptions(): Promise<Subscription<any>[]> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        return await this.fetchWithCredential(this.host, `${apiPath}/subscriptions/mine`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            return (await res.json()).content
        })
    }

    // Domain
    async getDomain(remote?: string): Promise<Domain | null | undefined> {
        const fqdn = remote || this.host
        if (!fqdn) throw new Error(`invalid remote: ${fqdn}`)
        if (this.domainCache[fqdn]) {
            const value = await this.domainCache[fqdn]
            if (value !== undefined) return value
        }

        this.domainCache[fqdn] = fetchWithTimeout(fqdn, `${apiPath}/domain`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                return null
            }
            const data = (await res.json()).content
            if (!data.ccid) {
                return null
            }
            const host = data
            this.domainCache[fqdn] = host
            return host
        }).catch((e) => {
            console.warn(e)
            return null
        })
        return await this.domainCache[fqdn]
    }

    async deleteDomain(remote: string): Promise<void> {
        await this.fetchWithCredential(this.host, `${apiPath}/domain/${remote}`, {
            method: 'DELETE',
            headers: {}
        })
    }

    async getDomains(remote?: string): Promise<Domain[]> {
        return await fetchWithTimeout(remote ?? this.host, `${apiPath}/domains`, {}).then(async (data) => {
            return (await data.json()).content
        })
    }

    async updateDomain(domain: Domain): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/domain/{domain.fqdn}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(domain)
        })
    }

    // Entity
    async getEntity(ccid: CCID, hint?: string): Promise<Entity | null | undefined> {
        if (this.entityCache[ccid]) {
            const value = await this.entityCache[ccid]
            if (value !== undefined) return value
        }

        let path = `/entity/${ccid}`
        if (hint) {
            path += `?hint=${hint}`
        }

        this.entityCache[ccid] = fetchWithTimeout(this.host, apiPath + path, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const entity = (await res.json()).content
            if (!entity || entity.ccid === '') {
                return undefined
            }

            return entity
        })
        return await this.entityCache[ccid]
    }

    async getAcking(ccid: string): Promise<Ack[]> {
        const host = await this.resolveAddress(ccid)
        if (!host) throw new Error('domain not found')

        let requestPath = `/entity/${ccid}/acking`
        const resp = await this.fetchWithOnlineCheck(host, requestPath, {
            method: 'GET',
            headers: {}
        })

        return (await resp.json()).content
    }

    async getAcker(ccid: string): Promise<Ack[]> {
        const host = await this.resolveAddress(ccid)
        if (!host) throw new Error('domain not found')

        let requestPath = `/entity/${ccid}/acker`
        const resp = await this.fetchWithOnlineCheck(host, requestPath, {
            method: 'GET',
            headers: {}
        })

        return (await resp.json()).content
    }

    async ack(target: string): Promise<any> {
        if (!this.ccid || !this.privatekey) throw new Error()

        const documentObj: CCDocument.Ack = {
            type: 'ack',
            signer: this.ccid,
            from: this.ccid,
            to: target,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/commit`, requestOptions)
        return await res.json()
    }

    async unack(target: string): Promise<any> {
        if (!this.ccid || !this.privatekey) throw new Error()

        const documentObj: CCDocument.Unack = {
            type: 'unack',
            signer: this.ccid,
            from: this.ccid,
            to: target,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        const document = JSON.stringify(documentObj)
        const signature = Sign(this.privatekey, document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/commit`, requestOptions)
        return await res.json()
    }

    async register(document: string, signature: string, info: any = {}, invitation?: string, captcha?: string): Promise<Response> {

        const optionObj = {
            info: JSON.stringify(info),
            invitation,
            document,
        }

        const option = JSON.stringify(optionObj)

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

        if (captcha) {
            headers['captcha'] = captcha
        }

        return await fetchWithTimeout(this.host, `${apiPath}/commit`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                document,
                signature,
                option
            })
        })
    }

    async updateRegistration(ccid: string, registration: string, signature: string): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/tmp/entity/${ccid}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ccid: ccid,
                registration,
                signature
            })
        })
    }

    async createEntity(ccid: string, meta: any = {}): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/admin/entity`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ccid: ccid,
                meta: JSON.stringify(meta)
            })
        })
    }

    async updateEntity(entity: Entity): Promise<Response> {
        const body: any = entity
        return await this.fetchWithCredential(this.host, `${apiPath}/entity/${entity.ccid}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })
    }

    async deleteEntity(ccid: CCID): Promise<void> {
        await this.fetchWithCredential(this.host, `${apiPath}/entity/${ccid}`, {
            method: 'DELETE',
            headers: {}
        })
    }

    async getEntities(): Promise<Entity[]> {
        return await fetchWithTimeout(this.host, `${apiPath}/entities`, {}).then(async (data) => {
            return (await data.json()).content
        })
    }

    invalidateEntity(ccid: CCID): void {
        delete this.entityCache[ccid]
    }

    // Collection
    async getCollection<T>(id: CollectionID): Promise<Collection<T> | null | undefined> {
        const key = id.split('@')[0]
        const domain = id.split('@')[1] ?? this.host
        return await this.fetchWithCredential(domain, `${apiPath}/collection/${key}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) return null
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = await res.json()
            if (data.status !== 'ok') {
                return undefined
            }
            const collection = data.content
            collection.id = id
            collection.items = collection.items.map((item: CollectionItem<T>) => {return {
                ...item,
                document: JSON.parse(item.document as string)
            }})
            return collection
        })
    }

    async createCollection<T>(
        schema: string,
        visible: boolean,
        { maintainer = [], writer = [], reader = [] }: { maintainer?: CCID[]; writer?: CCID[]; reader?: CCID[] } = {}
    ): Promise<Collection<T>> {
        return await this.fetchWithCredential(this.host, `${apiPath}/collection`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visible,
                schema,
                author: this.ccid,
                maintainer,
                writer,
                reader
            })
        }).then(async (res) => await res.json())
        .then((data) => {
            if (data.status !== 'ok') {
                return Promise.reject(new Error(data.message))
            }
            return data.content
        })
    }

    async updateCollection(collection: Collection<any>): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/collection/${collection.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(collection)
        })
    }

    async deleteCollection(id: CollectionID): Promise<void> {
        await this.fetchWithCredential(this.host, `${apiPath}/collection/${id}`, {
            method: 'DELETE',
            headers: {}
        })
    }

    async addCollectionItem<T>(collectionID: CollectionID, item: T): Promise<T> {
        return await this.fetchWithCredential(this.host, `${apiPath}/collection/${collectionID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(item)
        }).then(async (res) => {
            if (!res.ok) {
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = await res.json()
            return data.content
        })
    }

    async updateCollectionItem(id: CollectionID, item: any): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/collection/${id}/${item.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(item)
        })
    }

    async deleteCollectionItem<T>(id: CollectionID, item: string): Promise<CollectionItem<T>> {
        return await this.fetchWithCredential(this.host, `${apiPath}/collection/${id}/${item}`, {
            method: 'DELETE',
            headers: {}
        }).then(async (res) => await res.json())
        .then((data) => {
            if (data.status !== 'ok') {
                return Promise.reject(new Error(data.message))
            }
            const deleted = data.content
            deleted.document = JSON.parse(deleted.document as string)
            return deleted
        })
    }

    // KV
    async getKV(key: string): Promise<string | null | undefined> {
        return await this.fetchWithCredential(this.host, `${apiPath}/kv/${key}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const kv = await res.json()
            if (!kv || kv.content === '') {
                return null
            }
            return kv.content
        })
    }

    async writeKV(key: string, value: string): Promise<void> {
        await this.fetchWithCredential(this.host, `${apiPath}/kv/${key}`, {
            method: 'PUT',
            headers: {},
            body: value
        })
    }

    // Auth
    // enactSubkey
    async enactSubkey(subkey: string): Promise<void> {
        if (!this.ccid || !this.privatekey) throw new InvalidKeyError()
        const signObject: CCDocument.Enact = {
            signer: this.ccid,
            type: 'enact',
            target: subkey,
            root: this.ccid,
            parent: this.ckid ?? this.ccid,
            signedAt: new Date()
        }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const request = {
            signedObject,
            signature
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        await this.fetchWithCredential(this.host, `${apiPath}/key`, requestOptions)
    }


    // revokeSubkey
   async revokeSubkey(subkey: string): Promise<void> {
        if (!this.ccid || !this.privatekey) throw new InvalidKeyError()
        const signObject: CCDocument.Revoke = {
            signer: this.ccid,
            type: 'revoke',
            target: subkey,
            signedAt: new Date()
        }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const request = {
            signedObject,
            signature
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        await this.fetchWithCredential(this.host, `${apiPath}/key`, requestOptions)
   }

   // getKeyList
   async getKeyList(): Promise<Key[]> {
       return await this.fetchWithCredential(this.host, `${apiPath}/keys/mine`, {
           method: 'GET',
           headers: {}
       }).then(async (res) => {
           const data = await res.json()
           return data.content
       })
   }

   // getKeychain
   async getKeyResolution(ckid: string, owner: string): Promise<Key[]> {
        const host = await this.resolveAddress(owner)
        if (!host) throw new Error('domain not found')

       return await this.fetchWithCredential(host, `${apiPath}/key/${ckid}`, {
           method: 'GET',
           headers: {}
       }).then(async (res) => {
           const data = await res.json()
           return data.content
       })
   }

   // Admin
   async addDomain(remote: string): Promise<string> {
       return await this.fetchWithCredential(this.host, `${apiPath}/domain/${remote}`, {
           method: 'POST',
       }).then(async (data) => {
           return await data.json()
       })
   }

   getTokenClaims(): JwtPayload {
       if (!this.token) return {}
       return parseJWT(this.token)
   }
}
