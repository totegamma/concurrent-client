import { Api } from './api'

import { Socket } from './socket'
import { Timeline } from './timeline'
import { Subscription } from './subscription'

import { 
    Message as CoreMessage,
    Association as CoreAssociation,
    Entity as CoreEntity,
    Stream as CoreStream,
    CCID,
    FQDN,
    MessageID,
    AssociationID,
    StreamID,
    SignedObject,
} from "../model/core";

import { Schemas, Schema } from "../schemas";
import { Like } from "../schemas/like";
import { Profile } from "../schemas/profile";
import { EmojiAssociation } from "../schemas/emojiAssociation";
import { ReplyMessage } from "../schemas/replyMessage";
import { ReplyAssociation } from "../schemas/replyAssociation";
import { RerouteMessage } from "../schemas/rerouteMessage";
import { RerouteAssociation } from "../schemas/rerouteAssociation";
import { SimpleNote } from '../schemas/simpleNote'
import { Commonstream } from '../schemas/commonstream'

import { ComputeCCID, KeyPair, LoadKey, LoadSubKey } from "../util/crypto";
import { CreateCurrentOptions } from "../model/others";
import { fetchWithTimeout } from '..';

const cacheLifetime = 5 * 60 * 1000

interface Cache<T> {
    data: T
    expire: number
}

interface Service {
    path: string
}

export class Client {
    api: Api
    ccid?: CCID
    ckid?: string
    host: FQDN
    keyPair?: KeyPair;
    socket?: Socket
    domainServices: Record<string, Service> = {}
    ackings?: User[]

    user: User | null = null

    messageCache: Record<string, Cache<Promise<Message<any>>>> = {}

    constructor(host: FQDN, keyPair?: KeyPair, ccid?: string, options?: {ckid?: string, client?: string}) {
        this.keyPair = keyPair
        this.ccid = ccid
        this.host = host
        this.ckid = options?.ckid
        this.api = new Api({
            host,
            ccid: this.ccid,
            privatekey: keyPair?.privatekey,
            client: options?.client,
            ckid: options?.ckid
        })
    }

    static async createFromSubkey(subkey: string, client?: string): Promise<Client> {
        const key = LoadSubKey(subkey)
        if (!key) throw new Error('invalid subkey')
        const c = new Client(key.domain, key.keypair, key.ccid, {ckid: key.ckid, client})
        if (!c.ccid) throw new Error('invalid ccid')
        c.user = await c.getUser(c.ccid).catch((e) => {
            console.log('CLIENT::create::getUser::error', e)
            return null
        })
        c.ackings = await c.user?.getAcking()
        c.domainServices = await fetchWithTimeout(key.domain, '/services', {}).then((res) => res.json()).catch((e) => {
            console.log('CLIENT::create::fetch::error', e)
            return {}
        })

        return c
    }

    static async create(privatekey: string, host: FQDN, client?: string): Promise<Client> {
        const keyPair = LoadKey(privatekey)
        if (!keyPair) throw new Error('invalid private key')
        const ccid = ComputeCCID(keyPair.publickey)
        const c = new Client(host, keyPair, ccid, {client})
        if (!c.ccid) throw new Error('invalid ccid')
        const user = await c.getUser(c.ccid).catch((e) => {
            console.log('CLIENT::create::getUser::error', e)
            return null
        })
        c.user = user
        c.ackings = await c.user?.getAcking()
        c.domainServices = await fetchWithTimeout(host, '/services', {}).then((res) => res.json()).catch((e) => {
            console.log('CLIENT::create::fetch::error', e)
            return {}
        })

        return c
    }

    async reloadUser(): Promise<void> {
        if (!this.ccid) return
        this.user = await this.getUser(this.ccid).catch((e) => {
            console.log('CLIENT::create::getUser::error', e)
            return null
        })
    }

    async reloadAckings(): Promise<void> {
        if (!this.user) return
        this.ackings = await this.user.getAcking()
    }

    async getUser(id: CCID): Promise<User | null> {
        return await User.load(this, id)
    }

    async getStream<T>(id: StreamID): Promise<Stream<T> | null> {
        return await Stream.load(this, id)
    }

    async getAssociation<T>(id: AssociationID, owner: CCID): Promise<Association<T> | null | undefined> {
        return await Association.load(this, id, owner)
    }

    async getMessage<T>(id: MessageID, authorID: CCID, hint?: string): Promise<Message<T> | null | undefined> {
        const cached = this.messageCache[id]

        if (cached && cached.expire > Date.now()) {
            return cached.data
        }

        const message = Message.load(this, id, authorID, hint)

        this.messageCache[id] = {
            data: message as Promise<Message<any>>,
            expire: Date.now() + cacheLifetime
        }

        return this.messageCache[id].data
    }

    invalidateMessage(id: MessageID): void {
        delete this.messageCache[id]
    }

    async createCurrent(body: string, streams: StreamID[], options?: CreateCurrentOptions): Promise<Error | null> {
        if (!this.ccid) return new Error('ccid is not set')
        const newMessage = await this.api.createMessage<SimpleNote>(Schemas.simpleNote, {body, ...options}, streams)
        if(options?.mentions && options.mentions.length > 0) {
            const associationStream = []
            for(const mention of options.mentions) {
                const user = await this.getUser(mention)
                if(user?.profile?.notificationStream) {
                    associationStream.push(user.profile?.notificationStream)
                }
            }
            await this.api.createAssociation(Schemas.mention, {}, newMessage.content.id, this.ccid, 'messages', associationStream)
        }
        return newMessage
    }

    async getStreamsBySchema<T>(remote: FQDN, schema: string): Promise<Stream<T>[]> {
        const streams = await this.api.getStreamListBySchema<T>(schema, remote)
        return streams.map((e) => new Stream<T>(this, e))
    }

    async createCommonStream(name: string, description: string): Promise<void> {
        await this.api.createTimeline<Commonstream>(Schemas.commonstream, {
            name,
            shortname: name,
            description
        })
    }

    async setProfile(updates: {username?: string, description?: string, avatar?: string, banner?: string, subprofiles?: string[]}): Promise<void> {
        if (!this.ccid) throw new Error('ccid is not set')

        const current = (await this.api.getEntity<Profile>(this.ccid, Schemas.profile))?.extension?.document.body

        let homeStream = current?.homeStream
        if (!homeStream) {
            const res0 = await this.api.createTimeline(Schemas.utilitystream, {}, { indexable: false, domainOwned: false })
            homeStream = res0.id
            console.log('home', homeStream)
        }

        let notificationStream = current?.notificationStream
        if (!notificationStream) {
            const res1 = await this.api.createTimeline(Schemas.utilitystream, {}, { indexable: false, domainOwned: false })
            notificationStream = res1.id
            console.log('notification', notificationStream)
        }

        let associationStream = current?.associationStream
        if (!associationStream) {
            const res2 = await this.api.createTimeline(Schemas.utilitystream, {}, { indexable: false, domainOwned: false })
            associationStream = res2.id
            console.log('association', associationStream)
        }

        await this.api.setEntityExtension<Profile>(Schemas.profile, {
            username: updates.username ?? current?.username,
            description: updates.description ?? current?.description,
            avatar: updates.avatar ?? current?.avatar,
            banner: updates.banner ?? current?.banner,
            subprofiles: updates.subprofiles ?? current?.subprofiles,
            homeStream,
            notificationStream,
            associationStream,
        })

        await this.reloadUser()
    }

    async newSocket(): Promise<Socket> {
        if (!this.socket) {
            this.socket = new Socket(this.api, this)
            await this.socket.waitOpen()
        }
        return this.socket!
    }

    async newTimeline(): Promise<Timeline> {
        const socket = await this.newSocket()
        return new Timeline(this.api, socket)
    }

    async newSubscription(): Promise<Subscription> {
        const socket = await this.newSocket()
        return new Subscription(socket)
    }
}

export class User {

    api: Api
    client: Client

    ccid: CCID
    domain: FQDN 
    profile?: Profile
    _entity: CoreEntity<Profile>

    constructor(client: Client,
                domain: FQDN,
                entity: CoreEntity<Profile>,
                profile?: Profile,
    ) {
        this.api = client.api
        this.client = client
        this.ccid = entity.ccid
        this.domain = domain
        this.profile = profile
        this._entity = entity
    }

    static async load(client: Client, id: CCID): Promise<User | null> {
        const domain = await client.api.resolveAddress(id).catch((e) => {
            console.log('CLIENT::getUser::resolveAddress::error', e)
            return null
        })
        if (!domain) return null
        const entity = await client.api.getEntity<Profile>(id, Schemas.profile).catch((e) => {
            console.log('CLIENT::getUser::readEntity::error', e)
            return null
        })
        if (!entity) return null

        return new User(client, domain, entity, entity.extension?.document.body)
    }

    async getAcking(): Promise<User[]> {
        const acks = await this.api.getAcking(this.ccid)
        const users = await Promise.all(acks.map((e) => User.load(this.client, e.to)))
        return users.filter((e) => e !== null) as User[]
    }

    async getAcker(): Promise<User[]> {
        const acks = await this.api.getAcker(this.ccid)
        const users = await Promise.all(acks.map((e) => User.load(this.client, e.from)))
        return users.filter((e) => e !== null) as User[]
    }

    async Ack(): Promise<void> {
        await this.api.ack(this.ccid)
        await this.client.reloadAckings()
    }

    async UnAck(): Promise<void> {
        await this.api.unack(this.ccid)
        await this.client.reloadAckings()
    }


}

export class Association<T> implements CoreAssociation<T> {
    api: Api
    client: Client

    author: CCID
    cdate: string
    id: AssociationID
    document: SignedObject<T>
    _document: string
    schema: Schema
    signature: string
    targetID: MessageID
    targetType: 'messages' | 'characters'

    owner?: CCID

    authorUser?: User

    constructor(client: Client, data: CoreAssociation<T>) {
        this.api = client.api
        this.client = client
        this.author = data.author
        this.cdate = data.cdate
        this.id = data.id
        this.document = data.document
        this._document = data._document
        this.schema = data.schema
        this.signature = data.signature
        this.targetID = data.targetID
        this.targetType = data.targetType
    }

    static async load<T>(client: Client, id: AssociationID, owner: CCID): Promise<Association<T> | null> {
        const coreAss = await client.api.getAssociationWithOwner(id, owner).catch((e) => {
            console.log('CLIENT::getAssociation::readAssociationWithOwner::error', e)
            return null
        })
        if (!coreAss) return null

        const association = new Association<T>(client, coreAss)
        association.authorUser = await client.getUser(association.author) ?? undefined

        association.owner = owner

        return association
    }

    static async loadByBody<T>(client: Client, body: CoreAssociation<T>, owner?: string): Promise<Association<T> | null> {
        const association = new Association<T>(client, body)
        association.owner = owner
        association.authorUser = await client.getUser(association.author) ?? undefined

        return association
    }

    async getAuthor(): Promise<User> {
        const author = await this.client.getUser(this.author)
        if (!author) throw new Error('author not found')
        return author
    }

    async getTargetMessage(): Promise<Message<any>> {
        if (this.targetType !== 'messages') throw new Error(`target is not message (actual: ${this.targetType})`)
        if (!this.owner) throw new Error('owner is not set')
        const message = await this.client.getMessage(this.targetID, this.owner)
        if (!message) throw new Error('target message not found')
        return message
    }

    async delete(): Promise<void> {
        const { content } = await this.api.deleteAssociation(this.id, this.owner ?? this.author)
        this.api.invalidateMessage(content.targetID)
    }
}

export class Stream<T> implements CoreStream<T> {

    api: Api
    client: Client

    id: StreamID
    visible: boolean
    author: CCID
    maintainer: CCID[]
    writer: CCID[]
    reader: CCID[]
    schema: CCID
    document: T
    cdate: string

    constructor(client: Client, data: CoreStream<T>) {
        this.api = client.api
        this.client = client

        this.id = data.id
        this.visible = data.visible
        this.author = data.author
        this.maintainer = data.maintainer
        this.writer = data.writer
        this.reader = data.reader
        this.schema = data.schema
        this.document = data.document
        this.cdate = data.cdate
    }

    static async load<T>(client: Client, id: StreamID): Promise<Stream<T> | null> {
        const stream = await client.api.getStream(id).catch((e) => {
            console.log('CLIENT::getStream::readStream::error', e)
            return null
        })
        if (!stream) return null

        return new Stream<T>(client, stream)
    }

}

export class Message<T> implements CoreMessage<T> {

    api: Api
    user: User
    client: Client
    associations: Array<CoreAssociation<any>>
    ownAssociations: Array<CoreAssociation<any>>
    author: CCID
    cdate: string
    id: MessageID
    document: SignedObject<T>
    _document: string
    schema: Schema
    signature: string
    streams: StreamID[]

    associationCounts?: Record<string, number>
    reactionCounts?: Record<string, number>
    postedStreams?: Stream<any>[]

    authorUser?: User

    constructor(client: Client, data: CoreMessage<T>) {
        this.api = client.api
        this.user = client.user!
        this.client = client
        this.associations = data.associations ?? []
        this.ownAssociations = data.ownAssociations ?? []
        this.author = data.author
        this.cdate = data.cdate
        this.id = data.id
        this.document = data.document
        this._document = data._document
        this.schema = data.schema
        this.signature = data.signature
        this.streams = data.streams
    }

    static async load<T>(client: Client, id: MessageID, authorID: CCID, hint?: string): Promise<Message<T> | null> {
        const coreMsg = await client.api.getMessageWithAuthor(id, authorID, hint).catch((e) => {
            console.log('CLIENT::getMessage::readMessageWithAuthor::error', e)
            return null
        })
        if (!coreMsg) return null

        const message = new Message(client, coreMsg)

        message.authorUser = await client.getUser(authorID) ?? undefined
        try {
            message.associationCounts = await client.api.getMessageAssociationCountsByTarget(id, authorID)
            message.reactionCounts = await client.api.getMessageAssociationCountsByTarget(id, authorID, {schema: Schemas.emojiAssociation})
        } catch (e) {
            console.log('CLIENT::getMessage::error', e)
        }

        const streams = await Promise.all(
            message.streams.map((e) => client.getStream(e))
        )
        message.postedStreams = streams.filter((e) => e) as Stream<any>[]

        return message
    }

    async getAuthor(): Promise<User> {
        const author = await this.client.getUser(this.author)
        if (!author) {
            throw new Error('Author not found')
        }
        return author
    }

    async getStreams<T>() : Promise<Stream<T>[]> {
        const streams = await Promise.all(this.streams.map((e) => this.client.getStream(e)))
        return streams.filter((e) => e) as Stream<T>[]
    }

    async getReplyAssociations(): Promise<Association<ReplyAssociation>[]> {
        const coreass = await this.client.api.getMessageAssociationsByTarget<ReplyAssociation>(this.id, this.author, {schema: Schemas.replyAssociation})
        const ass: Array<Association<ReplyAssociation> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<ReplyAssociation>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<ReplyAssociation>>
    }

    async getRerouteAssociations(): Promise<Association<RerouteAssociation>[]> {
        const coreass = await this.client.api.getMessageAssociationsByTarget<RerouteAssociation>(this.id, this.author, {schema: Schemas.rerouteAssociation})
        const ass: Array<Association<Like> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<RerouteAssociation>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<RerouteAssociation>>
    }

    async getReplyMessages(): Promise<{association?: Association<ReplyAssociation>, message?: Message<ReplyMessage>}[]> {
        const associations = await this.client.api.getMessageAssociationsByTarget<ReplyAssociation>(this.id, this.author, {schema: Schemas.replyAssociation})
        const results = await Promise.all(
            associations.map(
                async (e) => {
                    return {
                        association: await Association.loadByBody<ReplyAssociation>(this.client, e, this.author) ?? undefined,
                        message: await this.client.getMessage<ReplyMessage>(e.document.body.messageId, e.document.body.messageAuthor) ?? undefined
                    }
                }
            )
        )
        return results
    }

    async getRerouteMessages(): Promise<{association?: Association<RerouteAssociation>, message?: Message<RerouteMessage>}[]> {
        const associations = await this.client.api.getMessageAssociationsByTarget<RerouteAssociation>(this.id, this.author, {schema: Schemas.rerouteAssociation})
        const results = await Promise.all(
            associations.map(
                async (e) => {
                    return {
                        association: await Association.loadByBody<RerouteAssociation>(this.client, e, this.author) ?? undefined,
                        message: await this.client.getMessage<RerouteMessage>(e.document.body.messageId, e.document.body.messageAuthor) ?? undefined
                    }
                }
            )
        )
        return results
    }

    async getFavorites(): Promise<Association<Like>[]> {
        const coreass = await this.client.api.getMessageAssociationsByTarget<Like>(this.id, this.author, {schema: Schemas.like})
        const ass: Array<Association<Like> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<Like>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<Like>>
    }

    async getReactions(imgUrl?: string): Promise<Association<EmojiAssociation>[]> {
        let query: any = {schema: Schemas.emojiAssociation}
        if (imgUrl) {
            query = {schema: Schemas.emojiAssociation, variant: imgUrl}
        }
        const coreass = await this.client.api.getMessageAssociationsByTarget<EmojiAssociation>(this.id, this.author, query)
        const ass: Array<Association<EmojiAssociation> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<EmojiAssociation>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<EmojiAssociation>>
    }

    async getReplyTo(): Promise<Message<ReplyMessage> | null> {
        if (this.schema != Schemas.replyMessage) {
            throw new Error('This message is not a reply')
        }
        const replyPayload = this.document.body as ReplyMessage
        return await Message.load<ReplyMessage>(this.client, replyPayload.replyToMessageId, replyPayload.replyToMessageAuthor)
    }

    async GetRerouteTo(): Promise<Message<RerouteMessage> | null> {
        if (this.schema != Schemas.rerouteMessage) {
            throw new Error('This message is not a reroute')
        }
        const reroutePayload = this.document.body as RerouteMessage
        return await Message.load<RerouteMessage>(this.client, reroutePayload.rerouteMessageId, reroutePayload.rerouteMessageAuthor)
    }

    async favorite() {
        const author = await this.getAuthor()
        const targetStream = [author.profile?.notificationStream, this.client.user?.profile?.associationStream].filter((e) => e) as string[]
        await this.api.createAssociation<Like>(Schemas.like, {}, this.id, author.ccid, 'messages', targetStream)
        this.api.invalidateMessage(this.id)
    }

    async reaction(shortcode: string, imageUrl: string) {
        const author = await this.getAuthor()
        const targetStream = [author.profile?.notificationStream, this.client.user?.profile?.associationStream].filter((e) => e) as string[]
        await this.client.api.createAssociation<EmojiAssociation>(
            Schemas.emojiAssociation,
            {
                shortcode,
                imageUrl
            },
            this.id,
            author.ccid,
            'messages',
            targetStream,
            imageUrl
        )
        this.api.invalidateMessage(this.id)
    }

    async deleteAssociation(associationID: string) {
        const { content } = await this.api.deleteAssociation(associationID, this.author)
        this.api.invalidateMessage(content.targetID)
    }

    async reply(streams: string[], body: string, options?: CreateCurrentOptions) {
        const data = await this.api.createMessage<ReplyMessage>(
          Schemas.replyMessage,
          {
              body,
              replyToMessageId: this.id,
              replyToMessageAuthor: this.author,
              ...options
          },
          streams
        )

        const author = await this.getAuthor()
        const targetStream = [author.profile?.notificationStream, this.user.profile?.associationStream].filter((e) => e) as string[]

        await this.api.createAssociation<ReplyAssociation>(
          Schemas.replyAssociation,
          { messageId: data.content.id, messageAuthor: this.user.ccid },
          this.id,
          this.author,
          'messages',
          targetStream || []
        )
    }

    async reroute(streams: string[], body?: string, options?: CreateCurrentOptions) {
        const { content } = await this.api.createMessage<RerouteMessage>(
            Schemas.rerouteMessage,
            {
                body,
                rerouteMessageId: this.id,
                rerouteMessageAuthor: this.author,
                ...options
            },
            streams
        )
        const created = content

        const author = await this.getAuthor()
        const targetStream = [author.profile?.notificationStream, this.user.profile?.associationStream].filter((e) => e) as string[]

        await this.api.createAssociation<RerouteAssociation>(
            Schemas.rerouteAssociation,
            { messageId: created.id, messageAuthor: created.author },
            this.id,
            this.author,
            'messages',
            targetStream
        )
    }

    async delete() {
        return this.api.deleteMessage(this.id)
    }
}

