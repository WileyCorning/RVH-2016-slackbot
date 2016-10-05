var express = require("express");
var bodyParser = require("body-parser");
var app = express();
var https = require('https');
var fs = require('fs');
var WebClient = require('@slack/client').WebClient;

var OAUTH_CLIENT_ID = '87743516672.87793061877';
var OAUTH_CLIENT_SECRET = '';
var SLACK_TOKEN = '';
var HACKQ_URL = 'rvhackathon.media.mit.edu';
var TEAM_CHANNEL_PREFIX = 'team-';
var MENTOR_GROUP_NAME = 'mentors';
var webClient = new WebClient(SLACK_TOKEN);

fs.readFile('../client-secret.txt','utf8',function(err,data){
  if(err) throw err;
  console.log(data);
  OAUTH_CLIENT_SECRET = data;
});

app.use(bodyParser.urlencoded({extended:true}));

app.post('/slackbot',function(req,res) {
  var cmd = req.body.command;
  var param = req.body.text.trim();
  console.log(req.body);
  var originatorName = req.body.user_name;
  var originatorId = req.body.user_id;

  var handleError = function(err) {
    console.log(err);
    res.send("Whoops! Looks like that didn't work. The reported error was " + err +"; if you're not sure why this happened, consider contacting a staff member.");
  }

  if(cmd == '/maketeam') {

    if(param == '') {
      res.send("Please enter a team name.");
      return;
    }

    createTeamChannel(param)
      .then(function(teamChannelData){
        return configureTeamChannel(param,teamChannelData.name,teamChannelData.id,originatorName,originatorId)
          .then(function() {
              res.send('Successfully created channel #'+teamChannelName+'.\nJoin now and invite your other team members!');
          });
      })
      .catch(handleError);
  }
});

app.get('/oauth',function(req,res){
  console.log(req.query);
  var code = req.query.code;
  if(!code) {
    res.send('No code');
    return;
  }
  var opts = {
    host: "slack.com",
    path: "/api/oauth.access?"+"client_id="+OAUTH_CLIENT_ID+"&client_secret="+OAUTH_CLIENT_SECRET+"&code="+code
  };

  console.log(opts);
  https.get(opts,function(authResponse){
    var s = '';
    authResponse.on('data',function(data){
      s += data;
    });
    authResponse.on('end',function() {
      console.log(s);
      res.send(s);
    });
  });
})

app.post('/hackq-notify',function(req,res) {
  var topic = req.body.topic;
  var s = "A new ticket was just created on "+HACKQ_URL + topic ? ":\n\t"+topic : ".";
  webClient.chat.postMessage(MENTOR_GROUP_NAME,s,function(err,res){});
});

app.listen(5789);



function createTeamChannel(teamNameRaw) {
  return new Promise(function(resolve,reject){
    teamName = teamNameRaw.toLowerCase().replace(' ', '-');
    teamChannelName = TEAM_CHANNEL_PREFIX+teamName;
    webClient.groups.create(teamChannelName,function(err,res) {
      if(err){
        reject(err);
      }
      else if(!res.ok) {
        reject(res.error);
      }
      else {
        console.log(res);
        resolve({name: res.group.name, id: res.group.id});
      }
    });
  });
}

function configureTeamChannel(teamName,teamChannelName, teamChannelId,teamCreatorName,teamCreatorId) {
  return getAllAccessUsers().then(function(allAccessUsers) {
    var promiseList = [];

    for(var i = 0; i < allAccessUsers.length; i++) {
      // Wrap in closure so we can report which user invite failed
      promiseList.push((function(user){
        return(inviteUser(teamChannelId,user).catch(function(err){
          console.log("Error inviting all-access user "+user+" to "+teamChannelName + ":\n\t"+err);
        }));
      })(allAccessUsers[i]));
    }

    return(Promise.all(promiseList));
  }).then(function() {
    return inviteUser(teamChannelId,teamCreatorId);
  }).then(function() {
    return postBlurb(teamName,teamChannelName,teamCreatorName);
  });
}

function inviteUser(channelId,username) {
  return new Promise(function(resolve,reject) {
    webClient.groups.invite(channelId,username,function(err,res){
      console.log("Inviting " + username + " to " + channelId);
      if(err){
        console.log(err+'\n'+channelId+' : ' + username);
        reject(err);
      }
      else {
        resolve(res);
      }
    });
  });
}

function postBlurb(teamName,teamChannelName,teamCreator) {
  return new Promise(function(resolve,reject) {
    var blurb = 'Welcome to the private channel for ' + teamName + ', created by ' +teamCreator + '.\n\n' +
      'Use the /invite command to invite other team members.\n\n' +
      'Staff and mentors also have access to this channel. ' +
      'If you need help with anything, let us know! Contact a mentor on '+HACKQ_URL+'.';
    webClient.chat.postMessage(teamChannelName,blurb,function(err,res){
      if(err){
        reject(err);
      }
      else if(!res.ok) {
        reject(res.error);
      }
      else {
        resolve(res);
      }
    });
  });
}

function getGroupIdByName(name) {
  return new Promise(function(resolve,reject){
    webClient.groups.list({},function(err,res){
      if(err){
        reject(err);
      }
      else if(!res.ok) {
        reject(res.error);
      }
      else {
        for(var i = 0; i < res.groups.length; i++) {
          if(res.groups[i].name == name) {
            resolve(res.groups[i].id);
            return;
          }
        }
        reject('Could not find group "'+name+'"');
      }
    })
  })

}

function getAllAccessUsers() {
  return Promise.all([getAdminIds(),getMentorIds()]).then(
    function(data) {
      var adminList = data[0];
      var mentorList = data[1];
      var allAccessUserIds = adminList.slice();

      for(var i = 0; i < mentorList.length; i++) {
        if(allAccessUserIds.indexOf(mentorList[i])==-1) {
          allAccessUserIds.push(adminList[i].id)
        }
      }
      return allAccessUserIds;
    }
  )
}

function getAdminIds() {
  return new Promise(function(resolve,reject) {
    webClient.users.list({},function(err,res){
      if(err){
        reject(err);
      }
      else if(!res.ok) {
        reject(res.error);
      }
      else {
        var adminIds = [];
        for(var i = 0; i < res.members.length; i++) {
          if(res.members[i].is_admin || res.members[i].is_owner) {
            adminIds.push(res.members[i].id);
          }
        }
        resolve(adminIds);
      }
    })
  })
}

function getMentorIds() {
  return getGroupIdByName(MENTOR_GROUP_NAME).then(function(mentorGroupId) {
    return new Promise(function(resolve,reject) {
      webClient.groups.info(mentorGroupId,function(err,res) {
        if(err){
          reject(err);
        }
        else if(!res.ok) {
          reject(res.error);
        }
        else {
          resolve(res.group.members);
        }
      });
    });
  });
}
