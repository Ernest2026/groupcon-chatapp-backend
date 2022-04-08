import typeDefs from "./typeDefs.js";
import resolvers from "./resolvers.js";
import jwt from "jsonwebtoken";

import { ApolloServer } from "apollo-server-express";
import express from "express";
import { WebSocketServer } from "ws";

import { useServer } from "graphql-ws/lib/use/ws";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { graphqlUploadExpress } from "graphql-upload";

const app = express();
const port = process.env.PORT || 4000;

const context = ({ req }) => {
  const { authorization } = req.headers;
  if (authorization) {
    const { userId, verified } = jwt.verify(
      authorization,
      process.env.JWT_SECRET
    );
    return { userId, verified };
  }
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

const apolloServer = new ApolloServer({ schema, context });

await apolloServer.start();
app.use(graphqlUploadExpress());
apolloServer.applyMiddleware({ app, path: "/graphql" });

app.use("/public", express.static("public"));

const server = app.listen(port, () => {
  const wsServer = new WebSocketServer({
    server,
    path: "/graphql",
  });

  useServer({ schema }, wsServer);
  console.log("Both socket are running");
});
