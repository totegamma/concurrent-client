export const Schemas = {
    simpleNote:         'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/messages/note/0.0.1.json',
    replyMessage:       'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/messages/reply/0.0.1.json',
    rerouteMessage:     'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/messages/reroute/0.0.1.json',

    like:               'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/associations/like/0.0.1.json',
    mention:               'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/associations/mention/0.0.1.json',
    replyAssociation:   'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/associations/reply/0.0.1.json',
    rerouteAssociation: 'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/associations/reroute/0.0.1.json',
    emojiAssociation:   'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/associations/emoji/0.0.1.json',
    userAck:            'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/associations/userack/v1.json',

    profile:            'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/characters/profile/v3.json',
    userstreams:        'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/characters/userstreams/0.0.1.json',
    domainProfile:      'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/characters/domainprofile/0.0.1.json',

    commonstream:       'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/streams/common/0.0.1.json',
    utilitystream:      'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/streams/utility/0.0.1.json',

    userAckCollection:  'https://raw.githubusercontent.com/totegamma/concurrent-schemas/master/collections/userack/v1.json',
} as const;

export type Schema = typeof Schemas[keyof typeof Schemas];

