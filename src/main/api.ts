import { v4 as uuidv4 } from 'uuid'

import { Entity, Message, Character, Association, Stream, SignedObject, CCID, StreamElement, Host, StreamID } from '../model/core'
import { MessagePostRequest } from '../model/request'
import { fetchWithTimeout } from '../util/misc'
import { Sign, SignJWT, checkJwtIsValid } from '../util/crypto'
import { Schema } from '../schemas'

const apiPath = '/api/v1'

export class Api {
    host: string
    ccid: string
    privatekey: string
    client: string

    token?: string

    entityCache: Record<string, Promise<Entity> | null | undefined> = {}
    messageCache: Record<string, Promise<Message<any>> | null | undefined> = {}
    characterCache: Record<string, Promise<Character<any>> | null | undefined> = {}
    associationCache: Record<string, Promise<Association<any>> | null | undefined> = {}
    streamCache: Record<string, Promise<Stream<any>> | null | undefined> = {}
    hostCache: Record<string, Promise<Host> | null | undefined> = {}

    constructor(ccid: string, privatekey: string, host: string, client?: string) {
        this.host = host
        this.ccid = ccid
        this.privatekey = privatekey
        this.client = client || 'N/A'
        console.log('oOoOoOoOoO API SERVICE CREATED OoOoOoOoOo')
    }

    async getJWT(): Promise<string> {
        const requestJwt = this.constructJWT({})
        const requestOptions = {
            method: 'GET',
            headers: { authorization: requestJwt }
        }
        return await fetchWithTimeout(`https://${this.host}${apiPath}/auth/claim`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                this.token = data.jwt
                return data.jwt
            })
    }


    async fetchWithCredential(url: RequestInfo, init: RequestInit, timeoutMs?: number): Promise<Response> {
        let jwt = this.token
        if (!jwt || !checkJwtIsValid(jwt)) {
            jwt = await this.getJWT()
        }
        const requestInit = {
            ...init,
            headers: {
                ...init.headers,
                authorization: 'Bearer ' + jwt
            }
        }
        return await fetchWithTimeout(url, requestInit, timeoutMs)
    }

    // Message
    async createMessage<T>(schema: Schema, body: T, streams: string[]): Promise<any> {
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

        const res = await this.fetchWithCredential(`https://${this.host}${apiPath}/messages`, requestOptions)

        return await res.json()
    }

    async readMessage(id: string, host: string = ''): Promise<Message<any> | null | undefined> {
        if (this.messageCache[id]) {
            const value = await this.messageCache[id]
            if (value !== undefined) return value
        }
        const messageHost = !host ? this.host : host
        this.messageCache[id] = fetch(`https://${messageHost}${apiPath}/messages/${id}`, {
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
        return await this.readMessage(messageId, entity.host)
    }

    async deleteMessage(target: string, host: string = ''): Promise<any> {
        const targetHost = !host ? this.host : host
        const requestOptions = {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id: target
            })
        }

        return await this.fetchWithCredential(`https://${targetHost}${apiPath}/messages`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
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
        const entity = await this.readEntity(targetAuthor)
        const targetHost = entity?.host || this.host
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

        return await this.fetchWithCredential(`https://${targetHost}${apiPath}/associations`, requestOptions)
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
        const targetHost = entity?.host || this.host
        const requestOptions = {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id: target
            })
        }

        return await this.fetchWithCredential(`https://${targetHost}${apiPath}/associations`, requestOptions)
            .then(async (res) => await res.json())
            .then((data: { status: string; content: Association<any> }) => {
                return data
            })
    }

    async readAssociation(id: string, host: string = ''): Promise<Association<any> | null | undefined> {
        if (this.associationCache[id]) {
            const value = await this.associationCache[id]
            if (value !== undefined) return value
        }
        const associationHost = !host ? this.host : host
        this.associationCache[id] = fetch(`https://${associationHost}${apiPath}/associations/${id}`, {
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
        return await this.readAssociation(associationId, entity.host)
    }

    // Character
    async upsertCharacter<T>(schema: Schema, body: T, id?: string): Promise<any> {
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

        return await this.fetchWithCredential(`https://${this.host}${apiPath}/characters`, requestOptions)
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
        let characterHost = entity?.host ?? this.host
        if (!characterHost || characterHost === '') characterHost = this.host
        this.characterCache[author + schema] = fetch(
            `https://${characterHost}${apiPath}/characters?author=${author}&schema=${encodeURIComponent(schema)}`,
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

    // Stream
    async createStream<T>(
        schema: string,
        body: T,
        { maintainer = [], writer = [], reader = [] }: { maintainer?: CCID[]; writer?: CCID[]; reader?: CCID[] } = {}
    ): Promise<any> {
        const signObject = {
            signer: this.ccid,
            type: 'Stream',
            schema,
            body,
            meta: {
                client: this.client
            },
            signedAt: new Date().toISOString(),
            maintainer,
            writer,
            reader
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const requestOptions = {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                signedObject,
                signature
            })
        }

        return await this.fetchWithCredential(`https://${this.host}${apiPath}/stream`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    async updateStream(id: string, partialSignObject: any): Promise<any> {
        const signObject = {
            ...partialSignObject,
            signer: this.ccid,
            type: 'Stream',
            meta: {
                client: this.client
            },
            signedAt: new Date().toISOString()
        }

        const signedObject = JSON.stringify(signObject)
        const signature = Sign(this.privatekey, signedObject)

        const requestOptions = {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id,
                signedObject,
                signature
            })
        }

        return await this.fetchWithCredential(`https://${this.host}${apiPath}/stream`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data
            })
    }

    async getStreamListBySchema(schema: string, remote?: string): Promise<Array<Stream<any>>> {
        return await fetch(`https://${remote ?? this.host}${apiPath}/stream/list?schema=${schema}`).then(
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
        this.streamCache[id] = fetch(`https://${host}${apiPath}/stream?stream=${key}`, {
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

    async readStreamRecent(streams: string[]): Promise<StreamElement[]> {
        const plan: Record<string, string[]> = {}
        for (const stream of streams) {
            const id = stream.split('@')[0]
            const host = stream.split('@')[1] ?? this.host
            plan[host] = [...(plan[host] ? plan[host] : []), id]
        }

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        let result: StreamElement[] = []
        for (const host of Object.keys(plan)) {
            if (!host) {
                console.warn('invalid query')
                continue
            }
            const response = await fetch(
                `https://${host}${apiPath}/stream/recent?streams=${plan[host].join(',')}`,
                requestOptions
            ).then(async (res) => await res.json())
            result = [...result, ...response]
        }
        // sort result
        result.sort((a, b) => {
            return parseFloat(b.timestamp.replace('-', '.')) - parseFloat(a.timestamp.replace('-', '.'))
        })
        // remove duplication
        result = result.filter((e, i, self) => {
            return (
                self.findIndex((s) => {
                    return s.id === e.id
                }) === i
            )
        })
        // clip max 16
        result = result.slice(0, 16)
        return result
    }

    async readStreamRanged(streams: string[], until?: string, since?: string): Promise<StreamElement[]> {
        const plan: Record<string, string[]> = {}
        for (const stream of streams) {
            const id = stream.split('@')[0]
            const host = stream.split('@')[1] ?? this.host
            plan[host] = [...(plan[host] ? plan[host] : []), id]
        }

        const requestOptions = {
            method: 'GET',
            headers: {}
        }

        const sinceQuery = !since ? '' : `&since=${since}`
        const untilQuery = !until ? '' : `&until=${until}`

        let result: StreamElement[] = []
        for (const host of Object.keys(plan)) {
            if (!host) {
                console.warn('invalid query')
                continue
            }
            const response = await fetch(
                `https://${host}${apiPath}/stream/range?streams=${plan[host].join(',')}${sinceQuery}${untilQuery}`,
                requestOptions
            ).then(async (res) => await res.json())
            result = [...result, ...response]
        }
        // sort result
        result.sort((a, b) => {
            return parseFloat(b.timestamp.replace('-', '.')) - parseFloat(a.timestamp.replace('-', '.'))
        })
        // remove duplication
        result = result.filter((e, i, self) => {
            return (
                self.findIndex((s) => {
                    return s.id === e.id
                }) === i
            )
        })
        // clip max 16
        result = result.slice(0, 16)
        return result
    }

    // Host
    async readHost(remote?: string): Promise<Host | null | undefined> {
        const fqdn = remote ?? this.host
        if (!fqdn) throw new Error()
        if (this.hostCache[fqdn]) {
            const value = await this.hostCache[fqdn]
            if (value !== undefined) return value
        }

        this.hostCache[fqdn] = fetch(`https://${fqdn}${apiPath}/host`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) return null
                return await Promise.reject(new Error(`fetch failed: ${res.status} ${await res.text()}`))
            }
            const data = await res.json()
            if (!data.ccaddr) {
                return undefined
            }
            const host = data
            this.hostCache[fqdn] = host
            return host
        })
        return await this.hostCache[fqdn]
    }

    async getKnownHosts(remote?: string): Promise<Host[]> {
        return await fetch(`https://${remote ?? this.host}${apiPath}/host/list`).then(async (data) => {
            return await data.json()
        })
    }

    // Entity
    async readEntity(ccaddr: CCID): Promise<Entity | null | undefined> {
        if (this.entityCache[ccaddr]) {
            const value = await this.entityCache[ccaddr]
            if (value !== undefined) return value
        }
        this.entityCache[ccaddr] = fetch(`https://${this.host}${apiPath}/entity/${ccaddr}`, {
            method: 'GET',
            headers: {}
        }).then(async (res) => {
            const entity = await res.json()
            if (!entity || entity.ccaddr === '') {
                return undefined
            }
            this.entityCache[ccaddr] = entity
            return entity
        })
        return await this.entityCache[ccaddr]
    }

    invalidateEntity(ccid: CCID): void {
        delete this.entityCache[ccid]
    }

    // KV
    async readKV(key: string): Promise<string | null | undefined> {
        return await this.fetchWithCredential(`https://${this.host}${apiPath}/kv/${key}`, {
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
        await this.fetchWithCredential(`https://${this.host}${apiPath}/kv/${key}`, {
            method: 'PUT',
            headers: {},
            body: value
        })
    }

    constructJWT(claim: Record<string, string>): string {
        const payload = JSON.stringify({
            jti: uuidv4(),
            iss: this.ccid,
            iat: Math.floor(new Date().getTime() / 1000).toString(),
            aud: this.host,
            nbf: Math.floor((new Date().getTime() - 5 * 60 * 1000) / 1000).toString(),
            exp: Math.floor((new Date().getTime() + 5 * 60 * 1000) / 1000).toString(),
            ...claim
        })
        return SignJWT(payload, this.privatekey)
    }
}
