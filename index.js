var coap        = require('coap')
  , server      = coap.createServer()
  , url		= require('url') // parsing urls
  , routes	= require('routes') // for routing requests
  , router	= new routes()
  , n3		= require('n3') // for building RDF documents
  , os		= require('os') // for getting the network IP address
  , CoapHandler	= require('./handler').CoapHandler

// values
var temperature		= 30.0,
    lastModified	= new Date()

// register RDF formats (otherwise packages are lost)
coap.registerFormat('application/rdf+xml', 201);
coap.registerFormat('text/turtle', 202);
coap.registerFormat('text/n3', 203);

// RDF prefixes
var prefixes = {
	'xsd': 'http://www.w3.org/2001/XMLSchema#',
	'itm': 'http://itm.uni-luebeck.de/'
};

// index route
router.addRoute('/.well-known/core', new CoapHandler(function(req, res) {
	if(req.headers['Accept'] && req.headers['Accept'] !== 'application/link-format') {
		res.code = 415;
		res.setOption('Content-Format', 'text/plain');
		res.end('Accept header must be application/link-format');
		return;
	}
	res.setOption('Content-Format', 'application/link-format'); // as defined in RFC 6690
	res.write([
		'</device>;ct=202;rt="http://itm.uni-luebeck.de/device05"',
		'</temperature>;obs;ct=202;rt="http://itm.uni-luebeck.de/groups/5/sensors/temperature"' // temperature is observable
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
	if(req.headers['Observe'] !== 0) {
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
	var match = router.match(path);
	if(!match) {
		res.code = 404;
		res.setOption('Content-Format', 'text/plain');
		res.end('File not found');
		return;
	}
	match.fn(req, res);
});

server.listen(function() {
  var req = coap.request({
	hostname: '141.83.151.196',
	method: 'POST',
	pathname: '/registry'
  });
 
  req.on('response', function(res) {
    res.pipe(process.stdout)
    res.on('end', function() {
      process.exit(0)
    })
  })
 
  req.end()
})

function buildDeviceRDF(res) {
	var writer = n3.Writer({prefixes: prefixes})
	writer.addTriple({
		subject: 'itm:device05',
		predicate: 'itm:hasLabel',
		object: n3.Util.createLiteral('Weather station')
	});
	writer.addTriple({
		subject: 'itm:device05',
		predicate: 'itm:hasGroup',
		object: n3.Util.createLiteral('SVA_05-SS15')
	});
	// get IP address
	var interfaces = os.networkInterfaces();
	var addresses = [];
	for (var k in interfaces) {
	    for (var k2 in interfaces[k]) {
		var address = interfaces[k][k2];
		if (address.family === 'IPv4' && !address.internal) {
		    addresses.push(address.address);
		}
	    }
	}
	if(addresses.length > 0) {
		writer.addTriple({
			subject: 'itm:device05',
			predicate: 'itm:hasIP',
			object: n3.Util.createLiteral(addresses[0])
		});
	}
	writer.addTriple({
		subject: 'itm:device05',
		predicate: 'itm:hasSensor',
		object: 'itm:groups/5/sensors/temperature'
	});
	writer.end(function(err, rdf) {
		res.write(rdf);
	});
}

function buildSensorRDF(res) {
	var writer = n3.Writer({prefixes : prefixes})
	writer.addTriple({
		subject: 'itm:groups/5/sensors/temperature',
		predicate: 'itm:lastModified',
		object: n3.Util.createLiteral(lastModified.toISOString(), 'xsd:dateTime')
	});
	writer.addTriple({
		subject: 'itm:groups/5/sensors/temperature',
		predicate: 'itm:hasStatus',
		object: 'itm:groups/5/sensors/temperatureStatus'
	});
	writer.addTriple({
		subject: 'itm:groups/5/sensors/temperatureStatus',
		predicate: 'itm:hasValue',
		object: n3.Util.createLiteral(Math.round(temperature * 10) / 10, 'xsd:float')
	});
	writer.end(function(err, rdf) {
		res.write(rdf);
	});
}
