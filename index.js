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
var url = require('url'),
    coap = require('coap'),
    server = coap.createServer(),
    url = require('url'), // parsing urls
    routes = require('routes'), // for routing requests
    router = new routes(),
    n3 = require('n3'), // for building RDF documents
    CoapHandler = require('./handler').CoapHandler;

// values
var temperature = 30.0,
    lastModified = new Date()

// register RDF formats (otherwise packages are lost)
coap.registerFormat('application/rdf+xml', 201);
coap.registerFormat('text/turtle', 202);
coap.registerFormat('text/n3', 203);

// RDF prefixes
var prefixes = {
    'xsd': 'http://www.w3.org/2001/XMLSchema#',
    'pit': 'http://pit.itm.uni-luebeck.de/'
    'grp5': 'http://group5.pit.itm.uni-luebeck.de/'
};

// index route
router.addRoute('/.well-known/core', new CoapHandler(function(req, res) {
    if (req.headers['Accept'] && req.headers['Accept'] !== 'application/link-format') {
        res.code = 415;
        res.setOption('Content-Format', 'text/plain');
        res.end('Accept header must be application/link-format');
        return;
    }
    res.setOption('Content-Format', 'application/link-format'); // as defined in RFC 6690
    res.write([
        '</device>;ct=202;rt="grp5:device1"',
        '</temperature>;obs;ct=202;rt="grp5:sensors/temperature"' // temperature is observable
    ].join(','));
    res.end();
}).handle);

// device information
router.addRoute('/device', new CoapHandler(function(req, res) {
    res.setOption('Content-Format', 'text/turtle');
    buildDeviceRDF(res);
    res.end();
}).handle);

// sensor status updates
router.addRoute('/temperature', new CoapHandler(function(req, res) {
    res.setOption('Content-Format', 'text/turtle');
    // respond
    if (req.headers['Observe'] !== 0) {
        buildSensorRDF(res);
        res.end();
        return;
    }
    var update = function() {
        // randomly set temperature
        lastModified = new Date();
        temperature = Math.min(Math.max(temperature + 0.5 - Math.random(), 20), 40);
        buildSensorRDF(res);
    };
    var interval = setInterval(update, 1000);
    update();

    res.on('finish', function(err) {
        clearInterval(interval);
    });
}).handle);

server.on('request', function(req, res) {
    var path = url.parse(req.url).pathname;
    console.log('Handling request for "%s"', path);
    var match = router.match(path);
    if (!match) {
        res.code = 404;
        res.setOption('Content-Format', 'text/plain');
        res.end('File not found');
        return;
    }
    match.fn(req, res);
});

server.listen(argv.p, function() {
    console.log('CoAP server listening on port ' + argv.p);
    if (!argv.r) {
        console.log('No registry specified, skipping registration (use --help)');
        return;
    }

    var registry = url.parse(argv.r.indexOf('coap://') === 0 ? argv.r : 'coap://' + argv.r)
    var req = coap.request({
        hostname: registry.hostname,
        port: registry.port ? registry.port : 5683,
        pathname: registry.pathname ? registry.pathname : '/registry',
        method: 'POST',
    });
    console.log('Registering at %s:%d%s', req.url.hostname, req.url.port, req.url.pathname);

    req.on('response', function(res) {
        res.pipe(process.stdout)
        res.on('end', function() {
            process.exit(0)
        })
    })
    req.on('error', function(err) {
        console.log('error: registration failed');
        console.log(err);
        process.exit(0)
    });

    req.end()
})

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
        object: 'grp5:sensors/temperature'
    });
    writer.end(function(err, rdf) {
        res.write(rdf);
    });
}

function buildSensorRDF(res) {
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
        object: n3.Util.createLiteral(Math.round(temperature * 10) / 10, 'xsd:float')
    });
    writer.end(function(err, rdf) {
        res.write(rdf);
    });
}
