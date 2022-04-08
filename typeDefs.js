import { gql } from "apollo-server-express";

// The GraphQL schema
const typeDefs = gql`
  type Query {
    getUsers(groupId: String!): [User]
    getMessages(skip: Int, groupId: String!): [Message]
    getGroup(groupId: String!): Group
    getProfile(profileId: Int!): Profile
  }

  type User {
    fullname: String
    email: String
    nickname: String
    id: ID
    Group: Group
    verified: Int
  }

  type Profile {
    id: Int
    userId: Int
    bio: String
    phone: String
    image: String
  }

  type Token {
    token: String!
    status: Boolean!
    groupId: String!
    userId: Int!
  }

  type Authtoken {
    token: String!
    verified: Int!
    userId: Int!
    groupId: String!
  }

  type Group {
    id: String
    name: String
    adminId: Int
  }

  type Message {
    id: Int!
    text: String
    audio: String
    audioTrans: String
    senderId: Int!
    sender: User
    audioTime: [TransTime]
    recieverId: String!
    createdAt: Date
    anonymous: Boolean!
  }

  type TransTime {
    word: String
    start: String
    end: String
    occurrence: Int
  }

  type Exitgroup {
    message: String
    admin: Boolean
  }

  type Userleft {
    id: Int
    groupId: String
    fullname: String
    nickname: String
  }

  type Subscription {
    messageAdded: Message
    userJoined: User
    userLeft: Userleft
  }

  scalar Date

  scalar Upload

  type Mutation {
    signupUser(newUser: newUser!): User
    signinUser(confirmUser: confirmUser): Authtoken
    createGroup(newGroup: newGroup!): Group
    editProfile(profileInput: profileInput!): Profile
    joinGroup(groupInput: groupInput!): Token
    sendMessage(messageInput: messageInput!): Message
    leaveGroup(groupId: String!): Exitgroup
  }

  input newUser {
    fullname: String!
    email: String!
    password: String!
    groupId: Int
  }

  input confirmUser {
    email: String!
    password: String!
  }

  input newGroup {
    name: String!
    password: String!
  }

  input groupInput {
    groupId: String!
    nickname: String
    password: String
  }

  input messageInput {
    text: String
    recieverId: String!
    blobFile: Upload
    anonymous: Boolean!
  }

  input profileInput {
    bio: String
    image: Upload
    phone: String
  }
`;

export default typeDefs;
