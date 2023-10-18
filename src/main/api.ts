
import { Entity, Message, Character, Association, Stream, SignedObject, CCID, StreamItem, Domain, StreamID, FQDN, Collection, CollectionID, CollectionItem } from '../model/core'
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
    privatekey?: string
    token?: string

    client: string

    entityCache: Record<string, Promise<Entity> | null | undefined> = {}
    messageCache: Record<string, Promise<Message<any>> | null | undefined> = {}
    characterCache: Record<string, Promise<Character<any>> | null | undefined> = {}
    associationCache: Record<string, Promise<Association<any>> | null | undefined> = {}
    streamCache: Record<string, Promise<Stream<any>> | null | undefined> = {}
    domainCache: Record<string, Promise<Domain> | null | undefined> = {}

    constructor(conf: {host: string, ccid?: string, privatekey?: string, client?: string, token?: string}) {
        this.host = conf.host
        this.ccid = conf.ccid
        this.privatekey = conf.privatekey
        this.client = conf.client || 'N/A'
        this.token = conf.token
        console.log('oOoOoOoOoO API SERVICE CREATED OoOoOoOoOo')
    }

    async getJWT(): Promise<string> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const requestJwt = IssueJWT(this.privatekey, {
            sub: 'CONCURRENT_APICLAIM',
            iss: this.ccid,
            aud: this.host
        })
        const requestOptions = {
            method: 'GET',
            headers: { authorization: requestJwt }
        }
        return await fetchWithTimeout(this.host, `${apiPath}/auth/claim`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                this.token = data.jwt
                return data.jwt
            })
    }

    async fetchWithOnlineCheck(domain: string, path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
        const host = await this.readDomain(domain)
        if (!host) return Promise.reject(new DomainOfflineError(domain))
        return await fetchWithTimeout(domain, `${apiPath}${path}`, init, timeoutMs)
    }

    async fetchWithCredential(domain: string, path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
        let jwt = this.token
        if (!jwt || !checkJwtIsValid(jwt)) {
            if (!this.privatekey) return Promise.reject(new JWTExpiredError())
            jwt = await this.getJWT()
        }
        const requestInit = {
            ...init,
            headers: {
                ...init.headers,
                authorization: 'Bearer ' + this.token
            }
        }
        return await fetchWithTimeout(domain, path, requestInit, timeoutMs)
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

    async readMessage(id: string, host: string = ''): Promise<Message<any> | null | undefined> {
        if (this.messageCache[id]) {
            const value = await this.messageCache[id]
            if (value !== undefined) return value
        }
        const messageHost = !host ? this.host : host
        this.messageCache[id] = this.fetchWithOnlineCheck(messageHost, `/message/${id}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) return null 
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = await res.json()
            if (!data.payload) {
                return undefined
            }
            const message = data
            message.rawpayload = message.payload
            message.payload = JSON.parse(message.payload)
            message.associations = message.associations.map((a: any) => {
                a.rawpayload = a.payload
                a.payload = JSON.parse(a.payload)
                return a
            })
            return message
        })
        return await this.messageCache[id]
    }

    async readMessageWithAuthor(messageId: string, author: string): Promise<Message<any> | null | undefined> {
        const entity = await this.readEntity(author)
        if (!entity) throw new Error()
        return await this.readMessage(messageId, entity.domain)
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
        streams: StreamID[]
    ): Promise<any> {
        if (!this.ccid || !this.privatekey) return Promise.reject(new InvalidKeyError())
        const entity = await this.readEntity(targetAuthor)
        const targetHost = entity?.domain || this.host
        const signObject: SignedObject<T> = {
            signer: this.ccid,
            type: 'Association',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date().toISOString(),
            target
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
        const entity = await this.readEntity(targetAuthor)
        const targetHost = entity?.domain || this.host
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

    async readAssociation(id: string, host: string = ''): Promise<Association<any> | null | undefined> {
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
            if (!data.association) {
                return undefined
            }
            const association = data.association
            association.rawpayload = association.payload
            association.payload = JSON.parse(association.payload)
            this.associationCache[id] = association
            return association
        })
        return await this.associationCache[id]
    }

    async readAssociationWithOwner(associationId: string, owner: string): Promise<Association<any> | null | undefined> {
        const entity = await this.readEntity(owner)
        if (!entity) throw new Error()
        return await this.readAssociation(associationId, entity.domain)
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
                return data
            })
    }

    async readCharacter(author: string, schema: string): Promise<Character<any> | null | undefined> {
        if (this.characterCache[author + schema]) {
            const value = await this.characterCache[author + schema]
            if (value !== undefined) return value
        }
        const entity = await this.readEntity(author)
        let characterHost = entity?.domain ?? this.host
        if (!characterHost || characterHost === '') characterHost = this.host
        this.characterCache[author + schema] = this.fetchWithOnlineCheck(
            characterHost,
            `/characters?author=${author}&schema=${encodeURIComponent(schema)}`,
            {
                method: 'GET',
                headers: {}
            }
        ).then(async (res) => {
            const data = await res.json()
            if (data.characters.length === 0) {
                return null
            }
            const character = data.characters[0]
            character.payload = JSON.parse(character.payload)
            this.characterCache[author + schema] = character
            return character
        })
        return await this.characterCache[author + schema]
    }

    invalidateCharacter(target: string): void {
        delete this.characterCache[target]
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

    async getStreamListBySchema(schema: string, remote?: FQDN): Promise<Array<Stream<any>>> {
        return await fetchWithTimeout(remote ?? this.host, `${apiPath}/streams?schema=${schema}`, {}).then(
            async (data) => {
                return await data.json().then((arr) => {
                    return arr.map((e: any) => {
                        return { ...e, payload: JSON.parse(e.payload) }
                    })
                })
            }
        )
    }

    async readStream(id: string): Promise<Stream<any> | null | undefined> {
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
            const data = await res.json()
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

    async readStreamRecent(streams: string[]): Promise<StreamItem[]> {

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
                const formed = data.map((e: any) => {
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

    async readStreamRanged(streams: string[], param: {until?: Date, since?: Date}): Promise<StreamItem[]> {

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
                const formed = data.map((e: any) => {
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
    async readDomain(remote?: string): Promise<Domain | null | undefined> {
        const fqdn = remote ?? this.host
        if (!fqdn) throw new Error()
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
            const data = await res.json()
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
            return await data.json()
        })
    }

    async updateDomain(domain: Domain): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/domain`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(domain)
        })
    }

    // Entity
    async readEntity(ccid: CCID): Promise<Entity | null | undefined> {
        if (this.entityCache[ccid]) {
            const value = await this.entityCache[ccid]
            if (value !== undefined) return value
        }
        this.entityCache[ccid] = fetchWithTimeout(this.host, `${apiPath}/entity/${ccid}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const entity = await res.json()
            if (!entity || entity.ccid === '') {
                return undefined
            }
            entity.certs = JSON.parse(entity.certs)
            return entity
        })
        return await this.entityCache[ccid]
    }

    async register(ccid: string, meta: any = {}, token?: string, captcha?: string): Promise<Response> {
        return await this.fetchWithCredential(this.host, `${apiPath}/entity`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ccid: ccid,
                meta: JSON.stringify(meta),
                token,
                captcha
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
        body.certs = JSON.stringify(entity.certs)
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
            return await data.json()
        })
    }

    invalidateEntity(ccid: CCID): void {
        delete this.entityCache[ccid]
    }

    // Collection
    async readCollection<T>(id: CollectionID): Promise<Collection<T> | null | undefined> {
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
    async readKV(key: string): Promise<string | null | undefined> {
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

    // Admin
    async sayHello (remote: string): Promise<string> {
        return await this.fetchWithCredential(this.host, `${apiPath}/admin/sayhello/${remote}`, {
        }).then(async (data) => {
            return await data.json()
        })
    }

    getTokenClaims(): JwtPayload {
        if (!this.token) return {}
        return parseJWT(this.token)
    }
}
