import { Api } from './api'

import { Socket } from './socket'
import { TimelineReader } from './timeline'
import { Subscription } from './subscription'

import { 
    Message as CoreMessage,
    Association as CoreAssociation,
    Entity as CoreEntity,
    Timeline as CoreTimeline,
    CCID,
    FQDN,
    MessageID,
    AssociationID,
    TimelineID,
} from "../model/core";

import { Schemas, Schema } from "../schemas";
import { 
    MarkdownMessageSchema,
    ReplyMessageSchema,
    RerouteMessageSchema,
    LikeAssociationSchema,
    ReactionAssociationSchema,
    ReplyAssociationSchema,
    RerouteAssociationSchema,
    ProfileSchema,
    CommunityTimelineSchema,

} from "../schemas/";

import { ComputeCCID, KeyPair, LoadKey, LoadSubKey } from "../util/crypto";
import { CreateCurrentOptions } from "../model/others";
import { CCDocument, fetchWithTimeout } from '..';

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

    async getTimeline<T>(id: TimelineID): Promise<Timeline<T> | null> {
        return await Timeline.load(this, id)
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

    async createMarkdownCrnt(body: string, streams: TimelineID[], options?: CreateCurrentOptions): Promise<Error | null> {
        if (!this.ccid) return new Error('ccid is not set')
        const newMessage = await this.api.createMessage<MarkdownMessageSchema>(Schemas.markdownMessage, {body, ...options}, streams)
        if(options?.mentions && options.mentions.length > 0) {
            const associationStream = []
            for(const mention of options.mentions) {
                //const user = await this.getUser(mention)
                //if(user?.profile?.notificationStream) {
                //    associationStream.push(user.profile?.notificationStream)
                //}
                associationStream.push('world.concrnt.t-notify@' + mention)
            }
            await this.api.createAssociation(Schemas.mentionAssociation, {}, newMessage.content.id, this.ccid, associationStream)
        }
        return newMessage
    }

    async getTimelinesBySchema<T>(remote: FQDN, schema: string): Promise<Timeline<T>[]> {
        const streams = await this.api.getTimelineListBySchema<T>(schema, remote)
        return streams.map((e) => new Timeline<T>(this, e))
    }

    async createCommunityTimeline(name: string, description: string): Promise<void> {
        await this.api.upsertTimeline<CommunityTimelineSchema>(Schemas.communityTimeline, {
            name,
            shortname: name,
            description
        })
    }

    async setProfile(updates: {username?: string, description?: string, avatar?: string, banner?: string, subprofiles?: string[]}): Promise<void> {
        if (!this.ccid) throw new Error('ccid is not set')


        let homeStream = await this.api.getTimeline('world.concrnt.t-home@' + this.ccid)
        if (!homeStream) {
            const res0 = await this.api.upsertTimeline(
                Schemas.emptyTimeline,
                {},
                {
                    semanticID: 'world.concrnt.t-home',
                    indexable: false,
                    domainOwned: false,
                    policy: 'https://policy.concrnt.world/t/inline-read-write.json',
                    policyParams: '{"isWritePublic": false, "isReadPublic": true, "writer": [], "reader": []}'
                }
            )
            console.log('home', res0)
        }

        let notificationStream = await this.api.getTimeline('world.concrnt.t-notify@' + this.ccid)
        if (!notificationStream) {
            const res1 = await this.api.upsertTimeline(
                Schemas.emptyTimeline,
                {},
                {
                    semanticID: 'world.concrnt.t-notify',
                    indexable: false,
                    domainOwned: false,
                    policy: 'https://policy.concrnt.world/t/inline-read-write.json',
                    policyParams: '{"isWritePublic": true, "isReadPublic": false, "writer": [], "reader": []}'
                }
            )
            console.log('notification', res1)
        }

        let associationStream = await this.api.getTimeline('world.concrnt.t-assoc@' + this.ccid)
        if (!associationStream) {
            const res2 = await this.api.upsertTimeline(
                Schemas.emptyTimeline,
                {},
                {
                    semanticID: 'world.concrnt.t-assoc',
                    indexable: false,
                    domainOwned: false,
                    policy: 'https://policy.concrnt.world/t/inline-read-write.json',
                    policyParams: '{"isWritePublic": false, "isReadPublic": true, "writer": [], "reader": []}'
                }
            )
            console.log('association', res2)
        }

        const currentprof = (await this.api.getProfileBySemanticID<ProfileSchema>('world.concrnt.p', this.ccid))?.document.body

        await this.api.upsertProfile<ProfileSchema>(Schemas.profile, {
            username: updates.username ?? currentprof?.username,
            description: updates.description ?? currentprof?.description,
            avatar: updates.avatar ?? currentprof?.avatar,
            banner: updates.banner ?? currentprof?.banner,
            subprofiles: updates.subprofiles ?? currentprof?.subprofiles,
        }, { semanticID: 'world.concrnt.p'})

        await this.reloadUser()
    }

    async newSocket(): Promise<Socket> {
        if (!this.socket) {
            this.socket = new Socket(this.api, this)
            await this.socket.waitOpen()
        }
        return this.socket!
    }

    async newTimelineReader(): Promise<TimelineReader> {
        const socket = await this.newSocket()
        return new TimelineReader(this.api, socket)
    }

    async newSubscription(): Promise<Subscription> {
        const socket = await this.newSocket()
        return new Subscription(socket)
    }
}

export class User implements CoreEntity {

    api: Api
    client: Client

    ccid: CCID
    tag: string
    domain: FQDN 
    cdate: string
    score: number

    affiliationDocument: string
    affiliationSignature: string

    tombstoneDocument?: string
    tombstoneSignature?: string

    profile?: ProfileSchema

    get notificationTimeline(): string {
        return 'world.concrnt.t-notify@' + this.ccid
    }

    get associationTimeline(): string {
        return 'world.concrnt.t-assoc@' + this.ccid
    }

    get homeTimeline(): string {
        return 'world.concrnt.t-home@' + this.ccid
    }

    constructor(client: Client,
                domain: FQDN,
                entity: CoreEntity,
                profile?: ProfileSchema
    ) {
        this.api = client.api
        this.client = client
        this.ccid = entity.ccid
        this.tag = entity.tag
        this.domain = domain
        this.cdate = entity.cdate
        this.score = entity.score
        this.affiliationDocument = entity.affiliationDocument
        this.affiliationSignature = entity.affiliationSignature
        this.tombstoneDocument = entity.tombstoneDocument
        this.tombstoneSignature = entity.tombstoneSignature

        this.profile = profile
    }

    static async load(client: Client, id: CCID): Promise<User | null> {
        const domain = await client.api.resolveAddress(id).catch((e) => {
            console.log('CLIENT::getUser::resolveAddress::error', e)
            return null
        })
        if (!domain) return null
        const entity = await client.api.getEntity(id).catch((e) => {
            console.log('CLIENT::getUser::readEntity::error', e)
            return null
        })
        if (!entity) return null

        const profile = await client.api.getProfileBySemanticID<ProfileSchema>('world.concrnt.p', id).catch((e) => {
            console.log('CLIENT::getUser::readProfile::error', e)
            return null
        })

        return new User(client, domain, entity, profile?.document.body ?? undefined)
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
    document: CCDocument.Association<T>
    _document: string
    schema: Schema
    signature: string
    target: MessageID
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
        this.target = data.target

        if (data.target[0] === 'm') {
            this.targetType = 'messages'
        } else {
            this.targetType = 'characters'
        }
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
        const message = await this.client.getMessage(this.target, this.owner)
        if (!message) throw new Error('target message not found')
        return message
    }

    async delete(): Promise<void> {
        const { content } = await this.api.deleteAssociation(this.id, this.owner ?? this.author)
        this.api.invalidateMessage(content.target)
    }
}

export class Timeline<T> implements CoreTimeline<T> {

    api: Api
    client: Client

    id: TimelineID
    indexable: boolean
    author: CCID
    domainOwned: boolean
    schema: CCID
    document: CCDocument.Timeline<T>
    signature: string
    cdate: string
    mdate: string

    constructor(client: Client, data: CoreTimeline<T>) {
        this.api = client.api
        this.client = client

        this.id = data.id
        this.indexable = data.indexable
        this.author = data.author
        this.domainOwned = data.domainOwned
        this.schema = data.schema
        this.document = data.document
        this.signature = data.signature
        this.cdate = data.cdate
        this.mdate = data.mdate
    }

    static async load<T>(client: Client, id: TimelineID): Promise<Timeline<T> | null> {
        const stream = await client.api.getTimeline(id).catch((e) => {
            console.log('CLIENT::Timeline::load::error', e)
            return null
        })
        if (!stream) return null

        return new Timeline<T>(client, stream)
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
    document: CCDocument.Message<T>
    _document: string
    schema: Schema
    signature: string
    timelines: TimelineID[]

    associationCounts?: Record<string, number>
    reactionCounts?: Record<string, number>
    postedStreams?: Timeline<any>[]

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
        this.timelines = data.timelines
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
            message.reactionCounts = await client.api.getMessageAssociationCountsByTarget(id, authorID, {schema: Schemas.reactionAssociation})
        } catch (e) {
            console.log('CLIENT::getMessage::error', e)
        }

        const timelines = await Promise.all(
            message.timelines.map((e) => client.getTimeline(e))
        )
        message.postedStreams = timelines.filter((e) => e) as Timeline<any>[]

        return message
    }

    async getAuthor(): Promise<User> {
        const author = await this.client.getUser(this.author)
        if (!author) {
            throw new Error('Author not found')
        }
        return author
    }

    async getTimelines<T>() : Promise<Timeline<T>[]> {
        const timelines = await Promise.all(this.timelines.map((e) => this.client.getTimeline(e)))
        return timelines.filter((e) => e) as Timeline<T>[]
    }

    async getReplyAssociations(): Promise<Association<ReplyAssociationSchema>[]> {
        const coreass = await this.client.api.getMessageAssociationsByTarget<ReplyAssociationSchema>(this.id, this.author, {schema: Schemas.replyAssociation})
        const ass: Array<Association<ReplyAssociationSchema> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<ReplyAssociationSchema>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<ReplyAssociationSchema>>
    }

    async getRerouteAssociations(): Promise<Association<RerouteAssociationSchema>[]> {
        const coreass = await this.client.api.getMessageAssociationsByTarget<RerouteAssociationSchema>(this.id, this.author, {schema: Schemas.rerouteAssociation})
        const ass: Array<Association<LikeAssociationSchema> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<RerouteAssociationSchema>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<RerouteAssociationSchema>>
    }

    async getReplyMessages(): Promise<{association?: Association<ReplyAssociationSchema>, message?: Message<ReplyMessageSchema>}[]> {
        const associations = await this.client.api.getMessageAssociationsByTarget<ReplyAssociationSchema>(this.id, this.author, {schema: Schemas.replyAssociation})
        const results = await Promise.all(
            associations.map(
                async (e) => {
                    return {
                        association: await Association.loadByBody<ReplyAssociationSchema>(this.client, e, this.author) ?? undefined,
                        message: await this.client.getMessage<ReplyMessageSchema>(e.document.body.messageId, e.document.body.messageAuthor) ?? undefined
                    }
                }
            )
        )
        return results
    }

    async getRerouteMessages(): Promise<{association?: Association<RerouteAssociationSchema>, message?: Message<RerouteMessageSchema>}[]> {
        const associations = await this.client.api.getMessageAssociationsByTarget<RerouteAssociationSchema>(this.id, this.author, {schema: Schemas.rerouteAssociation})
        const results = await Promise.all(
            associations.map(
                async (e) => {
                    return {
                        association: await Association.loadByBody<RerouteAssociationSchema>(this.client, e, this.author) ?? undefined,
                        message: await this.client.getMessage<RerouteMessageSchema>(e.document.body.messageId, e.document.body.messageAuthor) ?? undefined
                    }
                }
            )
        )
        return results
    }

    async getFavorites(): Promise<Association<LikeAssociationSchema>[]> {
        const coreass = await this.client.api.getMessageAssociationsByTarget<LikeAssociationSchema>(this.id, this.author, {schema: Schemas.likeAssociation})
        const ass: Array<Association<LikeAssociationSchema> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<LikeAssociationSchema>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<LikeAssociationSchema>>
    }

    async getReactions(imgUrl?: string): Promise<Association<ReactionAssociationSchema>[]> {
        let query: any = {schema: Schemas.reactionAssociation}
        if (imgUrl) {
            query = {schema: Schemas.reactionAssociation, variant: imgUrl}
        }
        const coreass = await this.client.api.getMessageAssociationsByTarget<ReactionAssociationSchema>(this.id, this.author, query)
        const ass: Array<Association<ReactionAssociationSchema> | null> = await Promise.all(coreass.map((e) => Association.loadByBody<ReactionAssociationSchema>(this.client, e, this.author)))
        return ass.filter(e => e) as Array<Association<ReactionAssociationSchema>>
    }

    async getReplyTo(): Promise<Message<ReplyMessageSchema> | null> {
        if (this.schema != Schemas.replyMessage) {
            throw new Error('This message is not a reply')
        }
        const replyPayload = this.document.body as ReplyMessageSchema
        return await Message.load<ReplyMessageSchema>(this.client, replyPayload.replyToMessageId, replyPayload.replyToMessageAuthor)
    }

    async GetRerouteTo(): Promise<Message<RerouteMessageSchema> | null> {
        if (this.schema != Schemas.rerouteMessage) {
            throw new Error('This message is not a reroute')
        }
        const reroutePayload = this.document.body as RerouteMessageSchema
        return await Message.load<RerouteMessageSchema>(this.client, reroutePayload.rerouteMessageId, reroutePayload.rerouteMessageAuthor)
    }

    async favorite() {
        const author = await this.getAuthor()
        //const targetStream = [author.profile?.notificationStream, this.client.user?.profile?.associationStream].filter((e) => e) as string[]
        const targetStream = ['world.concrnt.t-notify@' + author.ccid, 'world.concrnt.t-assoc@' + this.user.ccid]
        await this.api.createAssociation<LikeAssociationSchema>(Schemas.likeAssociation, {}, this.id, author.ccid, targetStream)
        this.api.invalidateMessage(this.id)
    }

    async reaction(shortcode: string, imageUrl: string) {
        const author = await this.getAuthor()
        //const targetStream = [author.profile?.notificationStream, this.client.user?.profile?.associationStream].filter((e) => e) as string[]
        const targetStream = ['world.concrnt.t-notify@' + author.ccid, 'world.concrnt.t-assoc@' + this.user.ccid]
        await this.client.api.createAssociation<ReactionAssociationSchema>(
            Schemas.reactionAssociation,
            {
                shortcode,
                imageUrl
            },
            this.id,
            author.ccid,
            targetStream,
            imageUrl
        )
        this.api.invalidateMessage(this.id)
    }

    async deleteAssociation(associationID: string) {
        const { content } = await this.api.deleteAssociation(associationID, this.author)
        this.api.invalidateMessage(content.target)
    }

    async reply(streams: string[], body: string, options?: CreateCurrentOptions) {
        const data = await this.api.createMessage<ReplyMessageSchema>(
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
        //const targetStream = [author.profile?.notificationStream, this.user.profile?.associationStream].filter((e) => e) as string[]
        const targetStream = ['world.concrnt.t-notify@' + author.ccid, 'world.concrnt.t-assoc@' + this.user.ccid]

        await this.api.createAssociation<ReplyAssociationSchema>(
          Schemas.replyAssociation,
          { messageId: data.content.id, messageAuthor: this.user.ccid },
          this.id,
          this.author,
          targetStream || []
        )
    }

    async reroute(streams: string[], body?: string, options?: CreateCurrentOptions) {
        const { content } = await this.api.createMessage<RerouteMessageSchema>(
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
        //const targetStream = [author.profile?.notificationStream, this.user.profile?.associationStream].filter((e) => e) as string[]
        const targetStream = ['world.concrnt.t-notify@' + author.ccid, 'world.concrnt.t-assoc@' + this.user.ccid]

        await this.api.createAssociation<RerouteAssociationSchema>(
            Schemas.rerouteAssociation,
            { messageId: created.id, messageAuthor: created.author },
            this.id,
            this.author,
            targetStream
        )
    }

    async delete() {
        return this.api.deleteMessage(this.id)
    }
}

