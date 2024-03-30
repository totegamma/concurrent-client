import { Api } from './api';
import { Association, Message, TimelineID, TimelineEvent } from '../model/core';
import { Client } from './client';

const WS = typeof window === 'undefined' ? require('ws') : window.WebSocket;

export class Socket {

    ws: any;
    api: Api;
    client?: Client;
    subscriptions: Map<string, Set<(event: TimelineEvent) => void>> = new Map()

    pingstate = false
    failcount = 0

    constructor(api: Api, client?: Client) {
        this.api = api;
        this.client = client;
        this.connect()
        setInterval(() => {
            this.checkConnection()
        }, 5000)
    }

    connect() {
        this.ws = new WS('wss://' + this.api.host + '/api/v1/socket');

        this.ws.onmessage = (rawevent: any) => {
            const event: TimelineEvent = JSON.parse(rawevent.data);
            if (!event) return

            if (event.type === 'pong') {
                this.pingstate = true
                return
            }

            switch (event.type + '.' + event.action) {
                case 'message.create':
                    if (event.body) {
                        const dummy_message: any = event.body
                        dummy_message._document = dummy_message.document
                        dummy_message.document = JSON.parse(dummy_message.document)
                        this.api.cacheMessage(dummy_message as Message<any>)
                    }
                    break
                case 'message.delete':
                    this.api.invalidateMessage(event.body.id)
                    this.client?.invalidateMessage(event.body.id)
                    break
                case 'association.create': {
                    if (event.body) {
                        const dummy_association: any = event.body
                        dummy_association._document = dummy_association.document
                        dummy_association.document = JSON.parse(dummy_association.document)
                        const association = dummy_association as Association<any>
                        this.api.cacheAssociation(association)
                        this.api.invalidateMessage(association.targetID)
                        this.client?.invalidateMessage(association.targetID)
                    }
                    break
                }
                case 'association.delete': {
                    if (event.body) {
                        const body = event.body as Association<any>
                        this.api.invalidateAssociation(body.id)
                        this.api.invalidateMessage(body.targetID)
                        this.client?.invalidateMessage(body.targetID)
                    }
                    break
                }
            }

            this.distribute(event.timelineID, event)
        }

        this.ws.onerror = (event: any) => {
            console.log('socket error', event)
        }

        this.ws.onclose = (event: any) => {
            console.log('socket close', event)
        }

        this.ws.onopen = (event: any) => {
            console.log('socket open', event)
            this.ws.send(JSON.stringify({ type: 'listen', channels: Array.from(this.subscriptions.keys()) }))
        }
    }

    checkConnection() {
        this.ping()
        if (this.pingstate) {
            this.pingstate = false
            this.failcount = 0
            return
        } else {
            this.failcount++
            console.log('ping fail', this.failcount)
            if (this.failcount > 3) {
                console.log('try to reconnect')
                this.ws.close()
                this.connect()
                this.failcount = 0
            }
        }
    }

    distribute(timelineID: string, event: TimelineEvent) {
        if (this.subscriptions.has(timelineID)) {
            this.subscriptions.get(timelineID)?.forEach(callback => {
                callback(event)
            })
        }
    }

    listen(timelines: TimelineID[], callback: (event: TimelineEvent) => void) {
        const currenttimelines = Array.from(this.subscriptions.keys())
        timelines.forEach(topic => {
            if (!this.subscriptions.has(topic)) {
                this.subscriptions.set(topic, new Set())
            }
            this.subscriptions.get(topic)?.add(callback)
        })
        const newtimelines = Array.from(this.subscriptions.keys())
        if (newtimelines.length > currenttimelines.length) {
            this.ws.send(JSON.stringify({ type: 'listen', channels: newtimelines }))
        }
    }

    unlisten(timelines: TimelineID[], callback: (event: TimelineEvent) => void) {
        const currenttimelines = Array.from(this.subscriptions.keys())
        timelines.forEach(topic => {
            if (this.subscriptions.has(topic)) {
                this.subscriptions.get(topic)?.delete(callback)

                if (this.subscriptions.get(topic)?.size === 0) {
                    this.subscriptions.delete(topic)
                }
            }
        })
        const newtimelines = Array.from(this.subscriptions.keys())
        if (newtimelines.length < currenttimelines.length) {
            this.ws.send(JSON.stringify({ type: 'unlisten', channels: newtimelines }))
        }
    }

    ping() {
        this.ws.send(JSON.stringify({ type: 'ping' }))
    }

    waitOpen() {
        return new Promise((resolve, reject) => {
            const maxNumberOfAttempts = 10
            const intervalTime = 200 //ms

            let currentAttempt = 0
            const interval = setInterval(() => {
                if (currentAttempt > maxNumberOfAttempts - 1) {
                    clearInterval(interval)
                    reject(new Error('Maximum number of attempts exceeded'))
                } else if (this.ws.readyState === WS.OPEN) {
                    clearInterval(interval)
                    resolve(true)
                }
                currentAttempt++
            }, intervalTime)
        })
    }
}


