import pc from "@prisma/client";
import bcrypt from "bcryptjs";
import { AuthenticationError, ForbiddenError } from "apollo-server-express";
import jwt from "jsonwebtoken";
import { PubSub } from "graphql-subscriptions";
import shortid from "shortid";
import { GraphQLUpload } from "graphql-upload";
import { Deepgram } from "@deepgram/sdk";
import fs from "file-system";
import path from "path";

shortid.characters(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$@"
);

const pubsub = new PubSub();

const { PrismaClient } = pc;

const prisma = new PrismaClient();
const __dirname = path.resolve();

const MESSAGE_ADDED = "MESSAGE_ADDED";
const USER_JOINED = "USER_JOINED";
const USER_LEFT = "USER_LEFT";

const deepgramApiKey = process.env.DEEPGRAM_API;
const deepgram = new Deepgram(deepgramApiKey);

const resolvers = {
  Upload: GraphQLUpload,
  Query: {
    getUsers: async (_, { groupId }, { userId }) => {
      if (!userId) throw new ForbiddenError("This user needs to sign in");
      const user = await prisma.user.findFirst({
        where: { id: userId, groupId: groupId },
      });
      if (!user)
        throw new ForbiddenError(
          "This user can't access this group information"
        );
      const data = await prisma.user.findMany({
        where: { groupId: groupId },
        include: { Group: true },
      });
      return data;
    },
    getMessages: async (_, { skip, groupId }, { userId }) => {
      if (!userId) throw new ForbiddenError("This user needs to sign in");
      const user = await prisma.user.findFirst({
        where: { id: userId, groupId: groupId },
      });
      if (!user)
        throw new ForbiddenError(
          "This user can't access this group information"
        );
      const data = await prisma.message.findMany({
        skip: skip ? skip : 0,
        take: 30,
        where: { recieverId: groupId },
        orderBy: { createdAt: "desc" },
        include: { sender: { select: { fullname: true, nickname: true } } },
      });
      return data.reverse();
    },
    getGroup: async (_, { groupId }, { userId }) => {
      if (!userId) throw new ForbiddenError("This user needs to sign in");
      const group = await prisma.group.findFirst({
        where: { id: groupId },
      });
      return group;
    },
    getProfile: async (_, { profileId }, { userId }) => {
      if (!userId) throw new ForbiddenError("This user needs to sign in");
      const profile = await prisma.profile.findFirst({
        where: { userId: profileId },
      });
      return profile;
    },
  },
  Mutation: {
    signupUser: async (_, { newUser }) => {
      const user = await prisma.user.findUnique({
        where: { email: newUser.email },
      });
      if (user)
        throw new AuthenticationError("This email is already registered");
      const hashPassword = await bcrypt.hash(newUser.password, 10);
      const data = await prisma.user.create({
        data: { ...newUser, password: hashPassword, verified: 1 },
      });
      const profile = await prisma.profile.create({
        data: { userId: data.id },
      });
      return data;
    },
    signinUser: async (_, { confirmUser }) => {
      const user = await prisma.user.findUnique({
        where: { email: confirmUser.email },
      });
      if (!user) throw new AuthenticationError("This user has not sign up...");
      const chkPass = await bcrypt.compare(confirmUser.password, user.password);
      if (!chkPass) throw new AuthenticationError("Wrong password");
      const token = jwt.sign(
        { userId: user.id, verified: user.verified },
        process.env.JWT_SECRET
      );
      return {
        token: token,
        verified: user.verified,
        groupId: `${user.groupId}`,
        userId: user.id,
      };
    },
    createGroup: async (_, { newGroup }, { userId, verified }) => {
      if (!verified) throw new ForbiddenError("This user needs to sign in");
      const hashPassword = await bcrypt.hash(newGroup.password, 10);
      const data = await prisma.group.create({
        data: {
          ...newGroup,
          password: hashPassword,
          adminId: userId,
          id: shortid.worker(1).generate(),
        },
      });
      const group = await prisma.user.update({
        where: { id: userId },
        data: { groupId: data.id },
      });
      return data;
    },
    joinGroup: async (_, { groupInput }, { userId }) => {
      const group = await prisma.group.findFirst({
        where: { id: groupInput.groupId },
      });
      if (!group) throw new ForbiddenError("Invalid group id");
      if (group.password && groupInput.password) {
        const chkPass = await bcrypt.compare(
          groupInput.password,
          group.password
        );
        if (!chkPass) throw new AuthenticationError("Wrong password");
      } else if (group.password && !groupInput.password) {
        throw new ForbiddenError("Please input password");
      }
      if (!groupInput.nickname) {
        const user = await prisma.user.update({
          where: { id: userId },
          data: { groupId: groupInput.groupId },
        });
        pubsub.publish(USER_JOINED, { userJoined: user });
        return {
          token: "",
          status: false,
          groupId: `${user.groupId}`,
          userId: user.id,
        };
      } else {
        const checkUser = await prisma.user.findFirst({
          where: { nickname: groupInput.nickname, groupId: groupInput.groupId },
        });
        if (checkUser)
          throw new ForbiddenError("This username already in user");
        const user = await prisma.user.create({
          data: { nickname: groupInput.nickname, groupId: groupInput.groupId },
        });
        const token = jwt.sign(
          { userId: user.id, verified: user.verified },
          process.env.JWT_SECRET
        );
        pubsub.publish(USER_JOINED, { userJoined: user });
        return {
          token: token,
          status: true,
          groupId: `${user.groupId}`,
          userId: user.id,
        };
      }
    },
    editProfile: async (
      _,
      { profileInput: { bio, phone, image } },
      { userId, verified }
    ) => {
      if (!verified) throw new ForbiddenError("This user needs to sign in");
      if (image) {
        const { createReadStream, filename } = await image;
        const { ext } = path.parse(filename);
        const newFilename = `${shortid
          .worker(3)
          .generate()}${Date.now().toString()}${ext}`;
        const pathName = `/public/image/${newFilename}`;
        const stream = createReadStream();
        stream.pipe(fs.createWriteStream(path.join(__dirname, pathName)));
        const prevImg = await prisma.profile.findUnique({
          where: { userId },
          select: { image: true },
        });
        const profile = await prisma.profile.update({
          where: { userId },
          data: { image: pathName },
        });
        prevImg.image &&
          fs.unlink(
            path.join(__dirname, prevImg.image),
            (err) => err && console.log(err)
          );
        return profile;
      } else {
        const profile = await prisma.profile.update({
          where: { userId },
          data: { bio, phone },
        });
        return profile;
      }
    },
    sendMessage: async (
      _,
      { messageInput: { text, recieverId, blobFile, anonymous } },
      { userId }
    ) => {
      if (!userId) throw new ForbiddenError("User isn't signed in");
      if (blobFile) {
        const { createReadStream, filename, mimetype } = await blobFile;
        const { ext } = path.parse(filename);
        const newFilename = `${shortid
          .worker(2)
          .generate()}${Date.now().toString()}${ext}`;
        const pathName = `/public/audio/${newFilename}`;
        let chunks = [];
        let fileBuffer, audioTrans, audioTime;

        const stream = createReadStream();
        stream.pipe(fs.createWriteStream(path.join(__dirname, pathName)));

        stream.on("data", (chunk) => {
          chunks.push(chunk);
        });

        stream.once("error", (err) => {
          console.error(err);
        });

        stream.once("end", async () => {
          fileBuffer = Buffer.concat(chunks);
          let source = {
            buffer: fileBuffer,
            mimetype: mimetype,
          };
          await deepgram.transcription
            .preRecorded(source, {
              punctuate: true,
            })
            .then((response) => {
              audioTrans =
                response.results.channels[0].alternatives[0].transcript;
              const words = response.results.channels[0].alternatives[0].words;
              const array = [];
              audioTime = words.filter(function (value) {
                var num = 0;
                array.push(value);
                array.map(
                  (o) => o.word === value.word && (o["occurrence"] = ++num)
                );
                return array;
              });
            })
            .catch((err) => {
              console.log(err);
            });

          var msgData = await prisma.message.create({
            data: {
              audio: pathName,
              audioTrans,
              audioTime,
              recieverId,
              anonymous,
              senderId: userId,
            },
            include: { sender: { select: { fullname: true, nickname: true } } },
          });
          pubsub.publish(MESSAGE_ADDED, { messageAdded: msgData });
          return msgData;
        });
      } else {
        var msgData = await prisma.message.create({
          data: {
            text,
            recieverId,
            senderId: userId,
            anonymous,
          },
          include: { sender: { select: { fullname: true, nickname: true } } },
        });
        pubsub.publish(MESSAGE_ADDED, { messageAdded: msgData });
        return msgData;
      }
    },
    leaveGroup: async (_, { groupId }, { userId }) => {
      const admin = await prisma.group.findFirst({
        where: { id: groupId, adminId: userId },
      });
      if (admin) {
        const audioList = [];
        const getallAudio = await prisma.message.findMany({
          where: {
            recieverId: groupId,
            text: null,
          },
          select: {
            audio: true,
          },
        });
        getallAudio.map((e) => audioList.push(e.audio));
        audioList.map((e) =>
          fs.unlink(path.join(__dirname, e), (err) => err && console.log(err))
        );
        const deleteGroup = await prisma.group.delete({
          where: { id: groupId },
        });
        const deleteUsers = await prisma.user.deleteMany({
          where: {
            groupId: null,
            email: null,
          },
        });
        const updateUsers = await prisma.user.updateMany({
          where: {
            AND: [{ groupId: groupId }, { NOT: { verified: 0 } }],
          },
          data: { groupId: null },
        });
        return { message: "Successfully closed the group", admin: true };
      } else {
        const updateUser = await prisma.user.update({
          where: { id: userId },
          data: { groupId: null },
          select: {
            id: true,
            fullname: true,
            nickname: true,
          },
        });
        pubsub.publish(USER_LEFT, { userLeft: { ...updateUser, groupId } });
        return { message: "Successfully left the group", admin: false };
      }
    },
  },
  Subscription: {
    messageAdded: {
      subscribe: () => pubsub.asyncIterator(MESSAGE_ADDED),
    },
    userJoined: {
      subscribe: () => pubsub.asyncIterator(USER_JOINED),
    },
    userLeft: {
      subscribe: () => pubsub.asyncIterator(USER_LEFT),
    },
  },
};

export default resolvers;
