import { Entity, Message, Association, Timeline, Profile, CCID, Domain, FQDN, Ack, Key, TimelineID, TimelineItem, Subscription } from '../model/core'
import { fetchWithTimeout, IsCCID } from '../util/misc'
import { Sign, IssueJWT, CheckJwtIsValid } from '../util/crypto'
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
    tokens: Record<string, string> = {}
    passport?: string

    client: string

    entityCache: Record<string, Promise<Entity> | null | undefined> = {}
    messageCache: Record<string, Promise<Message<any>> | null> = {}
    associationCache: Record<string, Promise<Association<any>> | null | undefined> = {}
    profileCache: Record<string, Promise<Profile<any>> | null | undefined> = {}
    timelineCache: Record<string, Promise<Timeline<any>> | null | undefined> = {}
    domainCache: Record<string, Promise<Domain> | null | undefined> = {}

    constructor(conf: {host: string, ccid?: string, privatekey?: string, client?: string, token?: string, ckid?: string}) {
        this.host = conf.host
        this.ccid = conf.ccid
        this.ckid = conf.ckid
        this.privatekey = conf.privatekey
        this.client = conf.client || 'N/A'

        if (conf.token) {
            this.tokens[conf.host] = conf.token
        } else {
            if (this.privatekey) this.tokens[conf.host] = this.generateApiToken(conf.host)
        }
        console.info('oOoOoOoOoO API SERVICE CREATED OoOoOoOoOo')
    }

    async getPassport(): Promise<string> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        return await this.fetchWithCredential(this.host, `${apiPath}/auth/passport`, {
            method: 'GET',
            headers: {}
        })
            .then(async (res) => await res.json())
            .then((data) => {
                this.passport = data.content
                return data.content
            })
    }

    generateApiToken(remote: string): string {

        if (!this.ccid || !this.privatekey) throw new InvalidKeyError()

        const token = IssueJWT(this.privatekey, {
            aud: remote,
            iss: this.ckid || this.ccid,
            sub: 'concrnt',
        })

        this.tokens[remote] = token

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

        let credential = this.tokens[domain]
        if (!credential || !CheckJwtIsValid(credential)) {
            if (this.privatekey) credential = this.generateApiToken(domain)
        }

        const headers: any = {
            ...init.headers,
        }

        if (credential) headers['authorization'] = 'Bearer ' + credential

        if (domain !== this.host && this.privatekey) {
            if (!this.passport) {
                await this.getPassport()
            }
            headers['passport'] = this.passport!
        }

        const requestInit = {
            ...init,
            headers
        }

        return await fetchWithTimeout(domain, path, requestInit, timeoutMs)
    }

    async resolveAddress(ccid: string, hint?: string): Promise<string | null | undefined> {
        const entity = await this.getEntity(ccid, hint)
        if (!entity) {
            return null
        }
        return entity.domain
    }


    // Message
    async createMessage<T>(
        schema: Schema,
        body: T,
        timelines: TimelineID[],
        { policy = undefined, policyParams = undefined }: { policy?: string, policyParams?: string } = {}
    ): Promise<any> {
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
            signedAt: new Date(),
            policy,
            policyParams
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

    async getMessage(id: string, host: string = ''): Promise<Message<any> | null> {

        if (this.messageCache[id]) {
            const value = await this.messageCache[id]
            if (value !== undefined) return value
        }

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        const messageHost = host || this.host
        if (this.tokens || this.privatekey)  {
            this.messageCache[id] = this.fetchWithCredential(messageHost, `${apiPath}/message/${id}`, requestOptions).then(async (res) => {

                if (!res.ok) {
                    if (res.status === 404) return null 
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }
                const data = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
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
                    return await Promise.reject(new Error(`getMessage failed on transport: ${res.status} ${await res.text()}`))
                }
                const data = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
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

        const cacheKey = `${owner}/${semanticID}`

        if (this.profileCache[cacheKey]) {
            const value = await this.profileCache[cacheKey]
            if (value !== undefined) return value
        }

        const targetHost = await this.resolveAddress(owner)
        if (!targetHost) throw new Error('domain not found')
        this.profileCache[cacheKey] = this.fetchWithOnlineCheck(targetHost, `/profile/${owner}/${semanticID}`, {
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

        return await this.profileCache[cacheKey]
    }

    async getProfileByID<T>(id: string, owner: string): Promise<Profile<T> | null | undefined> {

        const cacheKey = `${owner}/${id}`
        if (this.profileCache[cacheKey]) {
            const value = await this.profileCache[cacheKey]
            if (value !== undefined) return value
        }

        const targetHost = await this.resolveAddress(owner)
        if (!targetHost) throw new Error('domain not found')
        this.profileCache[cacheKey] = this.fetchWithOnlineCheck(targetHost, `/profile/${id}`, {
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

        return await this.profileCache[cacheKey]
    }

    invalidateProfile(id: string, owner: string): void {
        delete this.profileCache[`${owner}/${id}`]
    }

    async getProfiles<T>(query: {author?: string, schema?: string, domain?: string}): Promise<Profile<T>[]> {
        let requestPath = `/profiles?`

        let queries: string[] = []
        if (query.author) queries.push(`author=${query.author}`)
        if (query.schema) queries.push(`schema=${encodeURIComponent(query.schema)}`)

        requestPath += queries.join('&')

        const targetHost = query.domain ?? (query.author && await this.resolveAddress(query.author)) ?? this.host

        return await fetchWithTimeout(targetHost, `${apiPath}${requestPath}`, {}).then(async (data) => {
            return await data.json().then((data) => {
                return data.content.map((e: any) => {
                    e._document = e.document
                    e.document = JSON.parse(e.document)
                    return e
                })
            })
        })
    }

    async deleteProfile(id: string): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const documentObj: CCDocument.Delete = {
            signer: this.ccid,
            type: 'delete',
            target: id,
            signedAt: new Date()
        }

        if (this.ckid) {
            documentObj.keyID = this.ckid
        }

        return await this.commit(documentObj)
    }

    async upsertProfile<T>(
        schema: Schema,
        body: T,
        {id = undefined, semanticID = undefined, policy = undefined, policyParams = undefined }: {id?: string, semanticID?: string, policy?: string, policyParams?: string}
    ): Promise<Profile<T>> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const documentObj: CCDocument.Profile<T> = {
            id: id,
            semanticID: semanticID,
            signer: this.ccid,
            type: 'profile',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date(),
            policy,
            policyParams
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
        const profile = (await res.json()).content

        profile._document = profile.document
        profile.document = JSON.parse(profile.document)

        return profile
    }

    // Timeline
    async upsertTimeline<T>(
        schema: string,
        body: T,
        { id = undefined, semanticID = undefined, indexable = true, domainOwned = true, policy = undefined, policyParams = undefined }: { id?: string, semanticID?: string, indexable?: boolean, domainOwned?: boolean, policy?: string, policyParams?: string } = {}
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
            domainOwned,
            policy,
            policyParams
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
        if (this.timelineCache[id]) {
            const value = await this.timelineCache[id]
            if (value !== undefined) return value
        }
        let host = id.split('@')[1] ?? this.host

        if (IsCCID(host)) {
            const domain = await this.resolveAddress(host)
            if (!domain) throw new Error('domain not found: ' + host)
            host = domain
        }

        this.timelineCache[id] = this.fetchWithOnlineCheck(host, `/timeline/${id}`, {
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
            const timeline = data
            timeline.id = id
            timeline._document = timeline.document
            timeline.document = JSON.parse(timeline.document)
            this.timelineCache[id] = timeline
            return timeline
        })
        return await this.timelineCache[id]
    }

    async getTimelineRecent(timelines: string[]): Promise<TimelineItem[]> {

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        let result: TimelineItem[] = []

        try {
            const response = await this.fetchWithOnlineCheck(
                this.host,
                `/timelines/recent?timelines=${timelines.join(',')}`,
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

    async getTimelineRanged(timelines: string[], param: {until?: Date, since?: Date}): Promise<TimelineItem[]> {

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
                `/timelines/range?timelines=${timelines.join(',')}${sinceQuery}${untilQuery}`,
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
        { id = undefined, semanticID = undefined, indexable = true, domainOwned = true, policy = undefined, policyParams = undefined }: { id?: string, semanticID?: string, indexable?: boolean, domainOwned?: boolean, policy?: string, policyParams?: string } = {}
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
            domainOwned,
            policy,
            policyParams
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

    async getSubscription<T>(id: string): Promise<Subscription<T> | null | undefined> {
        const key = id.split('@')[0]
        let host = id.split('@')[1] ?? this.host

        if (IsCCID(host)) {
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


    async getOwnSubscriptions<T>(): Promise<Subscription<T>[]> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        return await this.fetchWithCredential(this.host, `${apiPath}/subscriptions/mine`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const data = await res.json()
            if (!data.content) {
                return []
            }

            return data.content.map((e: any) => {
                e._document = e.document
                e.document = JSON.parse(e.document)
                return e
            })
        })
    }

    async deleteSubscription(id: string): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        const documentObj: CCDocument.Delete = {
            signer: this.ccid,
            type: 'delete',
            target: id,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
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

    async getEntities(): Promise<Entity[]> {
        return await fetchWithTimeout(this.host, `${apiPath}/entities`, {}).then(async (data) => {
            return (await data.json()).content
        })
    }

    invalidateEntity(ccid: CCID): void {
        delete this.entityCache[ccid]
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

        return await this.commit(signObject)
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

        return await this.commit(signObject)
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
}
