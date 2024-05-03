export const Schemas = {
    markdownMessage:     'https://schema.concrnt.world/m/markdown.json',
    replyMessage:        'https://schema.concrnt.world/m/reply.json',
    rerouteMessage:      'https://schema.concrnt.world/m/reroute.json',

    likeAssociation:     'https://schema.concrnt.world/a/like.json',
    mentionAssociation:  'https://schema.concrnt.world/a/mention.json',
    replyAssociation:    'https://schema.concrnt.world/a/reply.json',
    rerouteAssociation:  'https://schema.concrnt.world/a/reroute.json',
    reactionAssociation: 'https://schema.concrnt.world/a/reaction.json',

    profile:             'https://schema.concrnt.world/p/main.json',

    communityTimeline:   'https://schema.concrnt.world/t/community.json',
    emptyTimeline:       'https://schema.concrnt.world/t/empty.json',

} as const;

export type Schema = typeof Schemas[keyof typeof Schemas];

