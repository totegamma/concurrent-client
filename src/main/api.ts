
import { Entity, Message, Character, Association, Stream, SignedObject, CCID, StreamItem, Domain, StreamID, FQDN, Collection, CollectionID, CollectionItem, Ack, AckObject, AckRequest, Key } from '../model/core'
import { MessagePostRequest } from '../model/request'
import { fetchWithTimeout } from '../util/misc'
import { Sign, IssueJWT, checkJwtIsValid, parseJWT, JwtPayload } from '../util/crypto'
import { Schema } from '../schemas'

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
    characterCache: Record<string, Promise<Character<any>> | null | undefined> = {}
    associationCache: Record<string, Promise<Association<any>> | null | undefined> = {}
    streamCache: Record<string, Promise<Stream<any>> | null | undefined> = {}
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
            sub: 'CC_API',
            scp: '*;*;*'
        })

        this.token = token

        return token
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
        if (this.addressCache[ccid]) {
            const value = await this.addressCache[ccid]
            if (value !== undefined) return value
        }
        let query = `/address/${ccid}`
        if (hint) {
            query += `?hint=${hint}`
        }
        this.addressCache[ccid] = this.fetchWithOnlineCheck(this.host, query, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const data = await res.json()
            if (!data.content) {
                return undefined
            }
            return data.content
        })
        return await this.addressCache[ccid]
    }

    // Message
    async createMessage<T>(schema: Schema, body: T, streams: string[]): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const signObject: SignedObject<T> = {
            signer: this.ccid,
            type: 'Message',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date().toISOString()
        }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const request: MessagePostRequest = {
            signedObject,
            signature,
            streams
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/message`, requestOptions)

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
                message.rawpayload = message.payload
                message.payload = JSON.parse(message.payload)

                message.ownAssociations = message.ownAssociations?.map((a: any) => {
                    a.rawpayload = a.payload
                    a.payload = JSON.parse(a.payload)
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
                message.rawpayload = message.payload
                message.payload = JSON.parse(message.payload)

                message.ownAssociations = message.ownAssociations?.map((a: any) => {
                    a.rawpayload = a.payload
                    a.payload = JSON.parse(a.payload)
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
            a.rawpayload = a.payload
            a.payload = JSON.parse(a.payload)
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
        const targetHost = !host ? this.host : host
        const requestOptions = {
            method: 'DELETE',
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/message/${target}`, requestOptions)
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
        targetType: string,
        streams: StreamID[],
        variant: string = ''
    ): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const targetHost = await this.resolveAddress(targetAuthor)
        if (!targetHost) throw new Error('domain not found')
        const signObject: SignedObject<T> = {
            signer: this.ccid,
            type: 'Association',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date().toISOString(),
            target,
            variant
        }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                targetType,
                signedObject,
                signature,
                streams
            })
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/association`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    async deleteAssociation(
        target: string,
        targetAuthor: CCID
    ): Promise<{ status: string; content: Association<any> }> {
        const targetHost = await this.resolveAddress(targetAuthor)
        if (!targetHost) throw new Error('domain not found')
        const requestOptions = {
            method: 'DELETE',
        }

        return await this.fetchWithCredential(targetHost, `${apiPath}/association/${target}`, requestOptions)
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
            association.rawpayload = association.payload
            association.payload = JSON.parse(association.payload)
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

    // Character
    async upsertCharacter<T>(schema: Schema, body: T, id?: string): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const signObject: SignedObject<T> = {
            signer: this.ccid,
            type: 'Character',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date().toISOString()
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
                character.rawpayload = character.payload
                character.payload = JSON.parse(character.payload)
                return character
            })
    }

    async getCharacter<T>(author: string, schema: string): Promise<Character<T> | null | undefined> {
        if (this.characterCache[author + schema]) {
            const value = await this.characterCache[author + schema]
            if (value !== undefined) return value
        }
        const targetHost = await this.resolveAddress(author)
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
            const character = data.content[0]
            character.payload = JSON.parse(character.payload)
            this.characterCache[author + schema] = character
            return character
        })
        return await this.characterCache[author + schema]
    }

    invalidateCharacterByID(id: string): void {
        Object.keys(this.characterCache).forEach(async (key) => {
            if ((await this.characterCache[key])?.id === id) {
                delete this.characterCache[key]
            }
        })
    }

    // Stream
    async createStream<T>(
        schema: string,
        payload: T,
        { maintainer = [], writer = [], reader = [], visible = true }: { maintainer?: CCID[]; writer?: CCID[]; reader?: CCID[]; visible?: boolean } = {}
    ): Promise<Stream<T>> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                visible,
                schema,
                payload: JSON.stringify(payload),
                author: this.ccid,
                maintainer,
                writer,
                reader,
            })
        }

        return await this.fetchWithCredential(this.host, `${apiPath}/stream`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data.content
            })
    }

    async updateStream(stream: Stream<any>): Promise<Stream<any>> {
        stream.payload = JSON.stringify(stream.payload)
        return await this.fetchWithCredential(this.host, `${apiPath}/stream/${stream.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(stream)
        }).then(async (res) => (await res.json()).content)
    }

    async deleteStream(id: string): Promise<any> {
        const requestOptions = {
            method: 'DELETE'
        }

        return await this.fetchWithCredential(this.host, `${apiPath}/stream/${id}`, requestOptions)
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

    async getStreamListBySchema<T>(schema: string, remote?: FQDN): Promise<Array<Stream<T>>> {
        return await fetchWithTimeout(remote ?? this.host, `${apiPath}/streams?schema=${schema}`, {}).then(
            async (data) => {
                return await data.json().then((data) => {
                    return data.content.map((e: any) => {
                        return { ...e, payload: JSON.parse(e.payload) }
                    })
                })
            }
        )
    }

    async getStream(id: string): Promise<Stream<any> | null | undefined> {
        if (this.streamCache[id]) {
            const value = await this.streamCache[id]
            if (value !== undefined) return value
        }
        const key = id.split('@')[0]
        const host = id.split('@')[1] ?? this.host
        this.streamCache[id] = this.fetchWithOnlineCheck(host, `/stream/${key}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) return null
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = (await res.json()).content
            if (!data.payload) {
                return undefined
            }
            const stream = data
            stream.id = id
            stream.payload = JSON.parse(stream.payload)
            this.streamCache[id] = stream
            return stream
        })
        return await this.streamCache[id]
    }

    async getStreamRecent(streams: string[]): Promise<StreamItem[]> {

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        let result: StreamItem[] = []

        try {
            const response = await this.fetchWithOnlineCheck(
                this.host,
                `/streams/recent?streams=${streams}`,
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

    async getStreamRanged(streams: string[], param: {until?: Date, since?: Date}): Promise<StreamItem[]> {

        console.log('readStreamRanged', streams, param)

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        const sinceQuery = !param.since ? '' : `&since=${Math.floor(param.since.getTime()/1000)}`
        const untilQuery = !param.until ? '' : `&until=${Math.ceil(param.until.getTime()/1000)}`

        let result: StreamItem[] = []
        try {
            const response = await this.fetchWithOnlineCheck(
                this.host,
                `/streams/range?streams=${streams.join(',')}${sinceQuery}${untilQuery}`,
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
    async getEntity(ccid: CCID): Promise<Entity | null | undefined> {
        if (this.entityCache[ccid]) {
            const value = await this.entityCache[ccid]
            if (value !== undefined) return value
        }

        const targetHost = await this.resolveAddress(ccid)
        if (!targetHost) throw new Error('domain not found')

        this.entityCache[ccid] = fetchWithTimeout(targetHost, `${apiPath}/entity/${ccid}`, {
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

       const signObject: SignedObject<AckObject> = {
           type: 'ack',
           signer: this.ccid,
           body: {
               from: this.ccid,
               to: target,
           },
           signedAt: new Date().toISOString()
       }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const request: AckRequest = {
            signedObject,
            signature
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/entities/ack`, requestOptions)
        return await res.json()
    }

    async unack(target: string): Promise<any> {
        if (!this.ccid || !this.privatekey) throw new Error()

       const signObject: SignedObject<AckObject> = {
           type: 'unack',
           signer: this.ccid,
           body: {
               from: this.ccid,
               to: target
           },
           signedAt: new Date().toISOString()
       }

        if (this.ckid) {
            signObject.keyID = this.ckid
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const request: AckRequest = {
            signedObject,
            signature
        }

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        }

        const res = await this.fetchWithCredential(this.host, `${apiPath}/entities/ack`, requestOptions)
        return await res.json()
    }

    async register(ccid: string, meta: any = {}, registration: string, signature: string, invitation?: string, captcha?: string): Promise<Response> {
        return await fetchWithTimeout(this.host, `${apiPath}/entity`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ccid: ccid,
                meta: JSON.stringify(meta),
                invitation,
                registration,
                signature,
                captcha
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
                payload: JSON.parse(item.payload as string)
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
            deleted.payload = JSON.parse(deleted.payload as string)
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
        const signObject: SignedObject<any> = {
            signer: this.ccid,
            type: 'enact',
            body: {
                CKID: subkey,
                Root: this.ccid,
                Parent: this.ckid ?? this.ccid
            },
            signedAt: new Date().toISOString()
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
        const signObject: SignedObject<any> = {
            signer: this.ccid,
            type: 'revoke',
            body: {
                CKID: subkey
            },
            signedAt: new Date().toISOString()
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
   async getKeychain(ckid: string): Promise<Key[]> {
       return await this.fetchWithCredential(this.host, `${apiPath}/key/${ckid}`, {
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
