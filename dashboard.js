var request = require("request")
var io = require('socket.io')();
var path = require('path');
var config = require(path.resolve(__dirname, 'config.json'));
var pmx = require('pmx');
var probe = pmx.probe();
var graphite = require('graphite');

//Setup graphite connection
if (config.graphite) 
  var graphite_client = graphite.createClient(config.graphite_host);

var master_server_list = "http://registry.dstar.su/api/node.php"
var masters = []

var master_list = []
var master_status = []

var masters_done = 0;
var count_shift = false;

var tmp_counts = {};
var tmp_country_cnt = {};

var counts = {'master': 0, 'dongle': 0, 'homebrew': 0, 'homebrewDgl': 0, 'slots_tx': 0, 'slots_rx': 0,'external': 0,'total': 0}
var country_cnt = {
  'dongle': {},
  'repeater': {},
  'homebrew': {},
  'homebrewDgl': {}
};

var connected_reflectors = []
var tmp_connected_reflectors = []

//Startup timers
setInterval(GetMasterList, 300 * 1000);
setInterval(GetMasterStats, 10 * 1000);
//setInterval(show_counters, 10 * 1000);
setInterval(shift_counters, 500);
if (config.graphite)
  setInterval(graphiteSend, config.graphite_interval * 60 * 1000);

//Initial startup tasks
GetMasterList();


//Get master list
function GetMasterList() {
  request({url: config.master_list, json: true}, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      masters = body
      console.log("Master list updated")
    } else console.log(error);
  })
}


function GetMasterStats() {
  // reset tmp variables
  masters_done = 0;
  tmp_counts = {'master': 0, 'repeater':0, 'dongle': 0, 'homebrew': 0, 'homebrewDgl': 0, 'slots_tx': 0, 'slots_rx': 0,'external': 0,'total': 0}
  tmp_country_cnt = {
    'dongle': {},
    'repeater': {},
    'homebrew': {},
    'homebrewDgl': {}
  };
  tmp_connected_reflectors = []

  for (var number in masters) {
    request({url: 'http://' + masters[number]['Address'] + '/status/status.php', json: true}, function (error, response, data) {
      if (error) {
        masters_done++;
        return;
      }
      tmp_counts['master']++
      count_shift = true;
      for (key in data)
      {
        var value = data[key];

        if (value['number'])
          var country = value['number'].toString().substring(0,3);
        else
          var country = 0

        if (value['type'] == 1) {
          if (value['name'] == "Hytera Multi-Site Connect" || value['name'] == "Motorola IP Site Connect") {
            tmp_counts['repeater']++
            tmp_country_cnt = GetCountryCount(tmp_country_cnt,'repeater',country);
          }
          if (value['name'] == "DV4mini") {
            tmp_counts['dongle']++;
            tmp_country_cnt = GetCountryCount(tmp_country_cnt,'dongle',country);
          }
          if (value['name'] == "MMDVM Host") {
            tmp_counts['homebrew']++;
            tmp_country_cnt = GetCountryCount(tmp_country_cnt,'homebrew',country);
          }
          if (value['name'] == "Homebrew Repeater") {
            if (value['values'][1] == 0) {
              tmp_counts['homebrewDgl']++;
              tmp_country_cnt = GetCountryCount(tmp_country_cnt,'homebrewDgl',country);
            }
            else
            {
              tmp_counts['homebrew']++;
              tmp_country_cnt = GetCountryCount(tmp_country_cnt,'homebrew',country);
            }
          }
          // Link has an outgoing lock
          if ((value['state'] & 0x2a) != 0)
            tmp_counts['slots_tx']++; 
          // Link has an incoming lock
          if ((value['state'] & 0x15) != 0)
            tmp_counts['slots_rx']++;
          tmp_counts['total']++; 
        }
        if (value['name'] == 'CBridge CC-CC Link')
        {
          tmp_counts['external'] = tmp_counts['external'] + value['values'][1];
        }

        if (value['name'] == 'D-Extra Link') {
          if ((value['state'] & 0x03) != 0)
            tmp_counts['external']++;
        }

        if (value['name'] == 'DCS Link') {
          if ((value['state'] & 0x03) != 0)
            tmp_counts['external']++;
        }
        if (value['name'] == 'AutoPatch') {
          if ((value['state'] & 0x03) != 0)
            tmp_counts['external']++;
        }
      }
      masters_done++;
    }
   ); 
  }
}

//makeing the country count arrays
function GetCountryCount(data,type,country) {
  if (data[type][country])
    data[type][country]++;
  else
    data[type][country] = 1;
  return data;
}

//Show counters
function show_counters() {
  if (counts['master'] > 0) {
    console.log(JSON.stringify(counts, null, 4));
    console.log(JSON.stringify(country_cnt, null, 4));
  }
}

//Send stats to graphite
function graphiteSend() {
  var metrics = {};
  if (counts['master'] == 0 && counts['repeater'] == 0) return;
  for (key in counts)
  {
    metrics['dmr.'+key] = counts[key]
  }
  graphite_client.write(metrics, function(err) {
    if (err) console.log("Unable to send to graphite");
  });
}

//Copy from tmp array to stats arrays when done
function shift_counters() {
  if (masters_done == tmp_counts['master'] && count_shift) {
    counts = tmp_counts;
    country_cnt = tmp_country_cnt; 
  }
}

