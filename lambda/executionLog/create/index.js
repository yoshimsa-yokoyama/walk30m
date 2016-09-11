'use strict';
console.log('Loading function');

let doc = require('dynamodb-doc');
let dynamo = new doc.DynamoDB();
let nodeUuid = require('node-uuid');

exports.handler = (event, context, callback) => {
  let uuid = nodeUuid.unparse(nodeUuid.v4(null, new Array(32), 0));
  let startDate = new Date(event.payload.start_datetime);
  let y = `${startDate.getFullYear()}`;
  let m = `${startDate.getMonth() + 1}`;
  let d = `${startDate.getDate()}`;

  if (m.length === 1) m = "0" + m;
  if (d.length === 1) d = "0" + d;

  dynamo.putItem({
    TableName: "execution_log",
    Item: Object.assign(event.payload, {
      uuid,
      start_datetime: +startDate,
      user_agent: event.userAgent,
      client_ip: event.sourceIp,
      y,
      ym: `${y}${m}`,
      ymd: `${y}${m}${d}`
    })
  }, (err) => {
    let res = {uuid};
    console.log(res, err);
    callback(null, res);
  });
};
