---
tags:
  - DistributedSystem
title: Key Value Server
---
# Key Value Server

## Introduction
> Each client interacts with the key/value server using a Clerk, which sends RPCs to the server, Clients can send two different RPCs to the server: `Put(key, value, version)` and `Get(key)` 
>
> Our goals is to build the server that ensures that each Put operation is executed at-most-once despite network failures and that the operations are *linearizable*.
> And implements a client-side locking, which ensures that a sequence of operations issued by a single client is executed atomically and in the correct order, and it isolates these multi-step operations from those of other clients.
## Solution

## Skeleton code
```go
//rpc.go
package rpc

type Err string

const (
	// Err's returned by server and Clerk
	OK         = "OK"
	ErrNoKey   = "ErrNoKey"
	ErrVersion = "ErrVersion"

	// Err returned by Clerk only
	ErrMaybe = "ErrMaybe"

	// For future kvraft lab
	ErrWrongLeader = "ErrWrongLeader"
	ErrWrongGroup  = "ErrWrongGroup"
)

type Tversion uint64

type PutArgs struct {
	Key     string
	Value   string
	Version Tversion
}

type PutReply struct {
	Err Err
}

type GetArgs struct {
	Key string
}

type GetReply struct {
	Value   string
	Version Tversion
	Err     Err
}
```

```go
//client.go
package kvsrv

import (
	"6.5840/kvsrv1/rpc"
	"6.5840/kvtest1"
	"6.5840/tester1"
	"time"
)


type Clerk struct {
	clnt   *tester.Clnt
	server string
}

func MakeClerk(clnt *tester.Clnt, server string) kvtest.IKVClerk {
	ck := &Clerk{clnt: clnt, server: server}
	return ck
}

func (ck *Clerk) Get(key string) (string, rpc.Tversion, rpc.Err) {
}

func (ck *Clerk) Put(key, value string, version rpc.Tversion) rpc.Err {
}
```

```go
//server.go
package kvsrv

import (
	"log"
	"sync"

	"6.5840/kvsrv1/rpc"
	"6.5840/labrpc"
	"6.5840/tester1"
)


type KVServer struct {
	mu sync.Mutex
	data map[string]KValue
}

type KValue struct {
	Value   string
	Version rpc.Tversion
}

func MakeKVServer() *KVServer {
	kv := &KVServer{}
	kv.data = make(map[string]KValue)
	return kv
}

func (kv *KVServer) Get(args *rpc.GetArgs, reply *rpc.GetReply) {
	
}
func (kv *KVServer) Put(args *rpc.PutArgs, reply *rpc.PutReply) {
}

```

