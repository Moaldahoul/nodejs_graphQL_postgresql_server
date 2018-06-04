import express from 'express';
import bodyParser from 'body-parser';
import { graphqlExpress, graphiqlExpress } from 'apollo-server-express';
import { makeExecutableSchema } from 'graphql-tools';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { execute, subscribe } from 'graphql';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import _ from 'lodash';
import DataLoader from 'dataloader';
import passport from 'passport';
import FacebookStrategy from 'passport-facebook';


import typeDefs from './schema';
import resolvers from './resolvers';
import models from './models';
import { refreshTokens } from './auth';


const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});
// const myGraphQLSchema = // ... define or import your schema here!

// secret file sould be added to .env file
const SECRET = 'asdfghjklqwertyuioppzxcvbnm';

const app = express();

passport.use(new FacebookStrategy(
  {
    clientID: process.env.FACEBOOK_CLIENT_ID, // need to be removed before to push it 
    clientSecret: process.env.FACEBOOK_SECRET_ID, // for real projects you need to add it to the secret place/file to save it and import it
    callbackURL: "http://localhost:3000/auth/facebook/callback"
},
async (accessToken, refreshToken, profile, cb) => {
  //2 Cases
  //#1 first time login
  // #2 other times
  const { id, displayName } = profile;
  //[]
  const fbUsers = await models.FbAuth.findAll({ 
                limit: 1, 
                where: { fb_id: id }
              });

  console.log(fbUsers);
  console.log(profile);
  
  if(!fbUsers.length){
    //create user
    const user = await models.User.create();
    await models.FbAuth.create({
      fb_id: id,
      display_name: displayName,
      user_id: user.id
    });
  }
  
  cb(null, {});
  /* User.findOrCreate({ facebookId: profile.id }, function (err, user) {
    return cb(err, user);
  }); */
},
),);

app.use(passport.initialize());

app.get('/flogin', passport.authenticate('facebook'));

app.get('/auth/facebook/callback',
  passport.authenticate('facebook', { session: false }), /* failureRedirect: '/login' */
  (req, res) => {
    res.send('Auth Succeed');
    // Successful authentication, redirect home.
    // res.redirect('/');
  },);

const addUser = async (req, res, next) => {
  const token = req.headers['x-token'];
  if(token){
    try {
      const { user } = await jwt.verify(token, SECRET);
      req.user = user;
    }catch (err){
      const refreshToken = req.headers['x-refresh-token'];
      const newTokens = await refreshTokens(
        token,
        refreshToken,
        models,
        SECRET,
      );
      if(newTokens.token && newTokens.refreshToken) {
        res.set('Access-Control-Expose-Headers', 'x-token, x-refresh-token');
        res.set('x-token', newTokens.token);
        res.set('x-refresh-token', newTokens.refreshToken);
      }
      req.user = newTokens.user;
    }
  }
  next();
};

app.use(cors('*'));
app.use(addUser);

app.use(
  '/graphiql',
  graphiqlExpress({ 
    endpointURL: '/graphql',
  }),
);

const batchSuggestions = async (keys, { Suggestion }) => {
  // key = [1, 2, 3, ..., 13]
  const suggestions = await Suggestion.findAll({
    raw: true,
    where: {
      boardId: {
        $in: keys,
      },
    },
  });
  // suggestion = [{ text:'hi', board:1 }, { text: 'bye', boardId: 2 },{ text: 'bye from sug, boardId: 2 }]
  const gs = _.groupBy(suggestions, 'boardId'); //gs: group suggestions
  //gs { 1: [{text: 'hi', boardId: 1}], 2: [{ text: 'bye', boardId: 2 },{ text: 'bye from sug, boardId: 2 }]
  return keys.map(k => gs[k] || []);
};

// bodyParser is needed just for POST.
app.use(
  '/graphql',
  bodyParser.json(),
  graphqlExpress( req => ({
    schema, 
    context: { 
      models,
      SECRET,
      user: req.user,
      suggestionLoader: new DataLoader(keys => batchSuggestions(keys, models)),
    },
  })),
);


const server = createServer(app);

models.sequelize.sync().then(() => 
  server.listen(3000, () => {
    new SubscriptionServer({
      execute,
      subscribe,
      schema,
    }, 
    {
      server,
      path: '/subscriptions',
    },);
  }),
); 