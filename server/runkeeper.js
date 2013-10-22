(function() {
  'use strict';
  var FIREBASE_URL, Firebase, MAX_WORKOUTS_PROCESSED_AT_A_TIME, RUNKEEPER_API_URL, RunKeeperStrategy, User, addWorkout, async, createRunKeeperUser, isRunKeeperId, loadAllWorkouts, loadRunKeeperUser, logger, passport, request, requestCallback, runKeeper, runKeeperWorkoutType, string, _;

  async = require('async');

  logger = require('./utils/logger');

  passport = require('passport');

  request = require('request');

  string = require('string');

  _ = require('underscore');

  Firebase = require('firebase');

  RunKeeperStrategy = require('passport-runkeeper').Strategy;

  User = require('../client/scripts/models/user').User;

  MAX_WORKOUTS_PROCESSED_AT_A_TIME = 20;

  RUNKEEPER_API_URL = 'https://api.runkeeper.com';

  FIREBASE_URL = 'https://fitspector.firebaseIO.com';

  requestCallback = function(cb) {
    return function(err, res, body) {
      if (!err && res.statusCode === 200) {
        return cb(null, body);
      } else {
        return cb(err);
      }
    };
  };

  runKeeper = {
    api: {
      accessToken: {
        uri: 'https://runkeeper.com/apps/token'
      },
      userInfo: {
        path: '/user',
        accept: 'application/vnd.com.runkeeper.User+json'
      },
      userActivities: {
        path: '/fitnessActivities?pageSize=1000',
        accept: 'application/vnd.com.runkeeper.FitnessActivityFeed+json'
      },
      profile: {
        path: '/profile',
        accept: 'application/vnd.com.runkeeper.Profile+json'
      }
    },
    callbackURL: process.env.RUN_KEEPER_CALLBACK_URL || (function() {
      throw new Error('Missing RUN_KEEPER_CALLBACK_URL');
    })(),
    clientId: process.env.RUN_KEEPER_ID || (function() {
      throw new Error('Missing RUN_KEEPER_ID');
    })(),
    secret: process.env.RUN_KEEPER_SECRET || (function() {
      throw new Error('Missing RUN_KEEPER_SECRET');
    })(),
    get: function(accessToken, config, cb) {
      var opts;
      opts = {
        url: RUNKEEPER_API_URL + config.path,
        json: {},
        headers: {
          Authorization: 'Bearer ' + accessToken,
          Accept: config.accept
        }
      };
      return request.get(opts, requestCallback(cb));
    }
  };

  runKeeperWorkoutType = function(type) {
    switch (type) {
      case "Running":
        return "run";
      case "Cycling":
        return "bik";
      case "Mountain Biking":
        return "bik";
      case "Walking":
        return "hik";
      case "Hiking":
        return "hik";
      case "Downhill Skiing":
        return "ski";
      case "Cross-Country Skiing":
        return "xcs";
      case "Swimming":
        return "swi";
      case "Rowing":
        return "row";
      case "Elliptical":
      case "Wheelchair":
      case "Snowboarding":
      case "Skating":
      case "Other":
        return "oth";
      default:
        log.error("Unknown RunKeeper workout type", type);
        return "oth";
    }
  };

  isRunKeeperId = function(id) {
    return string(id).startsWith('RKU');
  };

  addWorkout = function(userRef, workouts, data, cb) {
    var prefix, workout, workoutId;
    prefix = "/fitnessActivities/";
    if (!string(data.uri).startsWith(prefix)) {
      cb("Cannot get activity ID from its URI: " + data.uri);
      return;
    }
    workoutId = "RKW" + string(data.uri).chompLeft(prefix).toString();
    if (workouts && workouts[workoutId]) {
      cb(null, 0);
      return;
    }
    logger.info("Workout data: %j", data);
    workout = {
      exerciseType: runKeeperWorkoutType(data.type),
      startTime: data["start_time"],
      totalDistance: data["total_distance"],
      totalDuration: data.duration
    };
    userRef.child("workouts").child(workoutId).set(workout);
    logger.info("Processed workout ", workoutId, " -> ", workout);
    return cb(null, 1);
  };

  loadAllWorkouts = function(userId, accessToken) {
    var userRef;
    logger.info("Fetching all workouts for user: ", userId, " with token: ", accessToken);
    userRef = new Firebase("https://fitspector.firebaseIO.com/users").child(userId);
    return userRef.child("workouts").once("value", function(workouts) {
      return runKeeper.get(accessToken, runKeeper.api.userActivities, function(err, response) {
        var addWorkoutMap, cb;
        logger.info('Existing workouts: %s, RunKeeper error: %s, RunKeeper response: %s', workouts, err, response);
        addWorkoutMap = _.partial(addWorkout, userRef, workouts.val());
        cb = function(err, data) {
          var total;
          if (err) {
            return logger.error("Error while importing workouts for: ", userId, " -> ", err);
          } else {
            total = _.reduce(data, (function(x, y) {
              return x + y;
            }), 0);
            return logger.info("Imported ", total, "new exercises for ", userId);
          }
        };
        return async.mapLimit(response.items, MAX_WORKOUTS_PROCESSED_AT_A_TIME, addWorkoutMap, cb);
      });
    });
  };

  createRunKeeperUser = function(userId, token, done) {
    var createUser;
    logger.warn('createRunKeeperUser | id: %d | token: %d', userId, token);
    createUser = function(err, profile) {
      var user;
      logger.warn('createUser | %j', profile);
      if (err) {
        return done(err);
      }
      if (profile == null) {
        return done('Missing user profile');
      }
      user = User.fromRunKeeperProfile(profile, userId);
      new Firebase("" + FIREBASE_URL + "/users").child(userId).child('profile').update(user);
      logger.warn('  createdUser --> | %j', user);
      return done(null, user);
    };
    return runKeeper.get(token, runKeeper.api.profile, createUser);
  };

  loadRunKeeperUser = function(userId, token, done) {
    var finishLoading, loadUser, noUser;
    logger.warn('loadRunKeeperUser | id: %d | token: %s', userId, token);
    finishLoading = function(err, res) {
      done(err, res);
      if (token != null) {
        return loadAllWorkouts(userId, token);
      }
    };
    loadUser = function(userProfile) {
      var user;
      user = userProfile.val();
      logger.warn('user read from DB: %j', user);
      if (user != null) {
        return finishLoading(null, user);
      } else {
        return createRunKeeperUser(userId, token, finishLoading);
      }
    };
    noUser = function() {
      logger.warn('no user read from DB');
      return createRunKeeperUser(userId, token, finishLoading);
    };
    return new Firebase("" + FIREBASE_URL + "/users").child(userId).child('profile').once('value', loadUser, noUser);
  };

  module.exports = {
    runKeeperStrategy: function() {
      var callback, config;
      config = {
        clientID: runKeeper.clientId,
        clientSecret: runKeeper.secret,
        callbackURL: runKeeper.callbackURL
      };
      callback = function(token, tokenSecret, profile, done) {
        var userId;
        logger.warn('RunKeeper callback | token: %d | tokenSecret: %d | profile: %j', token, tokenSecret, profile);
        userId = 'RKU' + profile.id;
        return loadRunKeeperUser(userId, token, done);
      };
      return new RunKeeperStrategy(config, callback);
    },
    serializeUser: function(user, done) {
      return done(null, user.id);
    },
    deserializeUser: function(id, done) {
      switch (false) {
        case !isRunKeeperId(id):
          return loadRunKeeperUser(id, void 0, done);
        default:
          return done("Unknown user ID: " + id);
      }
    }
  };

}).call(this);
