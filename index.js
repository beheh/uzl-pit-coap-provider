// command line
var argv = require('yargs')
    .usage('Usage: $0 [options]')
    .example('$0 --port=5683 --registry=coap://141.83.151.196:5683/registry')
    .alias('p', 'port')
    .describe('p', 'The (local) port to run the SSP on')
    .default('p', 5683)
    .alias('r', 'registry')
    .describe('r', 'The URL of the registry')
    .help('h')
    .alias('h', 'help')
    .argv;

// imports
var url = require('url'), // parsing urls
    _ = require('underscore'); // comparing objects
async = require('async'); // async setup of serial/coap
coap = require('coap'),
    server = coap.createServer(),
    routes = require('routes'), // for routing requests
    router = new routes(),
    n3 = require('n3'), // for building RDF documents
    CoapHandler = require('./handler').CoapHandler;

// register RDF formats (otherwise packages are lost)
coap.registerFormat('application/rdf+xml', 201);
coap.registerFormat('text/turtle', 202);
coap.registerFormat('text/n3', 203);

// serial port
var serialport = require("serialport");
var port = new serialport.SerialPort("/dev/ttyACM0", {
    parser: serialport.parsers.readline('\r\n\r\n'),
    baudrate: 9600
}, false);


// RDF prefixes
var prefixes = {
    'xsd': 'http://www.w3.org/2001/XMLSchema#',
    'pit': 'http://pit.itm.uni-luebeck.de/',
    'grp5': 'http://grp05.pit.itm.uni-luebeck.de/'
};

// weather handler
var EventEmitter = require('events').EventEmitter;
var Weather = function() {
    EventEmitter.call(this);
};
Weather.prototype = new EventEmitter();
Weather.prototype.data = null;
Weather.prototype.lastModified = null;
Weather.prototype.updateData = function(data) {
    previousData = this.data;
    this.data = data;
    if (data !== null) {
        this.lastModified = new Date();
    }
    this.emit('data', data, this.lastModified);
};
var weather = new Weather();

// index route
router.addRoute('/.well-known/core', new CoapHandler(function(req, res) {
    if (req.headers['Accept'] && req.headers['Accept'] !== 'application/link-format') {
        res.code = 415;
        res.setOption('Content-Format', 'text/plain');
        res.end('Accept header must be application/link-format');
        return;
    }
    res.setOption('Content-Format', 'application/link-format'); // as defined in RFC 6690
    var endpoints = [];
    endpoints.push('</device>;ct=202;rt="grp5:device1"');
    if (weather.data !== null) {
        endpoints.push('</weather>;obs;ct=202'); // temperature is observable
    }
    res.write(endpoints.join(','));
    res.end();
}).handle);

// device information
router.addRoute('/device', new CoapHandler(function(req, res) {
    res.setOption('Content-Format', 'text/turtle');
    buildDeviceRDF(res);
    res.end();
}).handle);

// sensor status updates
router.addRoute('/weather', new CoapHandler(function(req, res) {
    res.setOption('Content-Format', 'text/turtle');

    // respond
    if (req.headers['Observe'] !== 0) {
        if (!buildSensorRDF(res, weather.data, weather.lastModified)) {
            res.end();
        }
        return;
    }

    notify = function(data, lastModified) {
        buildSensorRDF(res, data, lastModified);
    }

    // send initial update
    notify(weather.data, weather.lastModified);

    // send further updates
    weather.on('data', notify);

    res.on('finish', function(err) {
        weather.removeListener('data', notify);
    });
}).handle);

server.on('request', function(req, res) {
    var path = url.parse(req.url).pathname;
    console.log('CoAP: handling request for "%s"', path);
    var match = router.match(path);
    if (!match) {
        res.code = 404;
        res.setOption('Content-Format', 'text/plain');
        res.end('File not found');
        return;
    }
    try {
        match.fn(req, res);
    } catch (err) {
        console.log('Error handling "' + path + '": %s', err.message);
    }
});

async.parallel([
        function(callback) {
            server.listen(argv.p, function() {
                console.log('CoAP: server listening on port ' + argv.p);
                callback(null);
            })
        },
        function(callback) {
            port.on('error', function(error) {
                console.log('Serial port failed: %s', error.message);
                callback();
            });
            port.on('open', function(error) {
                if (error) {
                    console.log(error);
                    return;
                }

                console.log('Serial port: ready, waiting for data');

                weather.once('data', function() {
                    callback(null);
                });
            });
            port.open();
        }
    ],
    function(err, results) {
        if (err) {
            console.log('Setup failed: %s', err.message);
            process.exit(1);
        }
        console.log('Setup complete');

        // register with SSP
        if (!argv.r) {
            console.log('SSP: no registry specified, skipping registration (use --help)');
            return;
        }

        var registry = url.parse(new String(argv.r).indexOf('coap://') === 0 ? argv.r : 'coap://' + argv.r)
        var req = coap.request({
            hostname: registry.hostname,
            port: registry.port ? registry.port : 5683,
            pathname: registry.pathname ? registry.pathname : '/registry',
            method: 'POST',
        });
        console.log('SSP: registering at %s:%d%s', req.url.hostname, req.url.port, req.url.pathname);

        req.on('response', function(res) {
            res.pipe(process.stdout)
            res.on('end', function() {
                process.exit(0)
            })
        })
        req.on('error', function(err) {
            console.log('SSP registration failed: %s', err.message);
            process.exit(0)
        })

        req.end();
    });

port.on('data', function(data) {
    try {
        data = JSON.parse(new String(data));
        //console.log('Serial port: received %j', data);
        weather.updateData(data);
    } catch (err) {}
});

function buildDeviceRDF(res) {
    var writer = n3.Writer({
        prefixes: prefixes
    })
    writer.addTriple({
        subject: 'grp5:device1',
        predicate: 'pit:hasLabel',
        object: n3.Util.createLiteral('Weather station')
    });
    writer.addTriple({
        subject: 'grp5:device1',
        predicate: 'pit:hasGroup',
        object: n3.Util.createLiteral('SVA_05-SS15')
    });
    // get IP address
    var ips = require('./ip').getLocalIPs();
    ips.forEach(function(ip) {
        writer.addTriple({
            subject: 'grp5:device1',
            predicate: 'pit:hasIP',
            object: n3.Util.createLiteral(ip)
        });
    });
    writer.addTriple({
        subject: 'grp5:device1',
        predicate: 'pit:hasSensor',
        object: 'grp5:sensor1'
    });
    writer.end(function(err, rdf) {
        res.write(rdf);
    });
}

function buildSensorRDF(res, data, lastModified) {
    if (data === null) {
        res.code = 404;
        res.setOption('Content-Format', 'text/plain');
        res.end('No data available');
        return true;
    }

    var writer = n3.Writer({
        prefixes: prefixes
    })
    writer.addTriple({
        subject: 'grp5:sensor1',
        predicate: 'pit:lastModified',
        object: n3.Util.createLiteral(lastModified.toISOString(), 'xsd:dateTime')
    });
    writer.addTriple({
        subject: 'grp5:sensor1',
        predicate: 'pit:hasStatus',
        object: 'grp5:status1'
    });
    writer.addTriple({
        subject: 'grp5:status1',
        predicate: 'pit:hasValue',
        object: n3.Util.createLiteral(data.temperature, 'xsd:string')
    });
    writer.end(function(err, rdf) {
        res.write(rdf);
    });
}
