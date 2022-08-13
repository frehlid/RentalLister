// EXpress app. This app will have an endpoint that receives a url to an online rental listing from a google sheets document.
// Then, the url will be parsed. If the domain is supported, the app will make a request to the url.
// It will parse the response, looking for attributes such as:
// - price
// - # of bedrooms
// - # of bathrooms
// - square footage
// - photos
// With these attributes, the app will then make api calls to google sheets to update the sheet with the new data.


const supported_domains = ["craigslist"];

// ---------- EXPRESS APP ----------
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// ---------- REQUEST ----------
const axios = require('axios');

// ---------- cheerio ----------
const cheerio = require('cheerio');

// ---------- dotenv ----------
require('dotenv').config();


app.listen(port, () => {
	  console.log(`Listening on port ${port}`);
});

app.get('/listing', (req, res) => {
	const url = req.query.url;
	const domain = url.split('/')[2].split('.')[1];
	console.log(domain);
	if (domainSupported(domain)) {
		axios.get(url).then(response => {
			const html = response.data;
			const listing = dispatchParser(domain, html, url)
			updateSpreadsheet(listing);
			res.redirect('/');
	});
	} else {
		res.send('Domain not supported');
	}
});

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

// dispatches to the correct parser for the domain
function dispatchParser(domain, html, url) {
	if (domain === 'craigslist') {
		return parseCraigslistListing(html, url);
	}
}

// parses the html of a craglist listing. returns a JSON object with the follwing attributes:
// - price
// - # of bedrooms
// - # of bathrooms
// - square footage
// - photos
function parseCraigslistListing(html, url) {
	const $ = cheerio.load(html);
	// get the element "ld_posting_data" which contains some of the listing attributes
	const ld_posting_data = $('#ld_posting_data').html();
	// parse the json string
	const json = JSON.parse(ld_posting_data);
	// get the listing attributes
	const bedrooms = parseInt(json.numberOfBedrooms);
	const bathrooms = parseInt(json.numberOfBathroomsTotal);
	const type = json.type;
	const name = json.name;

	// get the address from <div class="mapaddress">
	const address = $('div.mapaddress').text();
	// get the price from <span class="price">
	const price = $('span.price').text();
	// get the size from <span class="housing">, replace all dashes and spaces with nothing, then split on 'br'
	var size = $('span.housing').text().replace(/[-\s]/g, '').split('br')[1];
	console.log(size);
	var units;

	// replace $ and , with nothing 
	const price_num = parseInt(price.replace(/\$|,/g, ''));	
	
	if (size.includes('ft') || size.includes('ft2') || size.includes('sqft')) {
		units = 'sqft';
	} else if (size.includes('m') || size.includes('m2') || size.includes('sqm')) {
		units = 'm2';
	}
	size = parseInt(size);
	const Price_Per_Sqft = price_num / size;
	const Price_Per_Person = price_num / bedrooms;

	// get the coordinates from meta name="ICBM"
	const coordinates = $('meta[name="ICBM"]').attr('content');
	const lat = coordinates.split(',')[0];
	const lon = coordinates.split(',')[1];
	var Distance_To_UBC = haversineDistance([49.2606, -123.2460], [lat, lon], false);
	const Bus_Routes_Nearby = "";
	
	
	// get the content of the meta tag with property "og:image"
	const og_image = $('meta[property="og:image"]').attr('content');

	// combine the attributes into a json object
	const listing = {
		Image: '=IMAGE("' + og_image + '")',
		Name: '=HYPERLINK("' + url + '", "' + name + '")',
		Price: price,
		Size : size + ' ' + units,
		Address: address,
		Distance_To_UBC: Distance_To_UBC,
		Bus_Routes_Nearby: Bus_Routes_Nearby,
		Bathrooms: bathrooms,
		Price_Per_Person: Price_Per_Person + " $ / person",
		Price_Per_Sqft: Price_Per_Sqft + " $ / " + units,
		Lon: lon,
		Lat: lat,
		Type: type
	}
	return listing;

}

// Google maps API costs money to calculate distance, 
// so instead we just use the Haversine formula to calculate the distance between two points on a sphere.
function haversineDistance(coords1, coords2, isMiles) {
	function toRad(x) {
	  return x * Math.PI / 180;
	}
  
	var lon1 = coords1[0];
	var lat1 = coords1[1];
  
	var lon2 = coords2[0];
	var lat2 = coords2[1];
  
	var R = 6371; // radius of earth in km
  
	var x1 = lat2 - lat1;
	var dLat = toRad(x1);
	var x2 = lon2 - lon1;
	var dLon = toRad(x2)
	var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
	  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
	  Math.sin(dLon / 2) * Math.sin(dLon / 2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	var d = R * c;
  
	if(isMiles) d /= 1.60934;
  
	return d;
}

// checks if the domain is in the list of supported domains
function domainSupported(domain) {
	return supported_domains.includes(domain);
}

// ---------- Google Sheets API ----------
const { GoogleSpreadsheet } = require('google-spreadsheet');
const sheet_id = process.env.SHEET_ID;
const doc = new GoogleSpreadsheet(sheet_id);
const creds = require('./rental-finder-key.json');
doc.useServiceAccountAuth(creds);
setupSpreadsheet();

async function setupSpreadsheet() {
	console.log('setting up spreadsheet');
	await doc.loadInfo();
	const sheet = doc.sheetsByIndex[0];
	sheet.setHeaderRow(['Image', 'Name', 'Price', 'Size', 'Address', 'Distance_To_UBC', 'Bus_Routes_Nearby', 'Bedrooms', 'Bathrooms', "Price_Per_Person", "Price_Per_Sqft", "Lon", "Lat", "Type"]);
}


// ---------- UPDATE SPREADSHEET ----------
// updates the spreadsheet with the given listing
async function updateSpreadsheet(listing) {
	await doc.loadInfo();
	const sheet = doc.sheetsByIndex[0];

	// get the number of the last row in the sheet 
	// (for some reason we have to use the sheet.getRows() method). sheet.rowCount is the whole sheet, not just the data
	const rows = await sheet.getRows();
	const numRows = rows.length + 1;
	const numCols = 15; // hardcoded for now
	console.log(numCols);
	console.log(numRows);

	// for each cell at (0,numRows) -> (numCols,numRows) set the value to the listing attribute
	// format the cell as well
	await sheet.loadCells("A1:P" + (numRows+1000)) // load the cells in the range
	for (let i = 0; i < numCols; i++) {
		const cell = sheet.getCell(numRows, i);
		
		if (i === 0) {
			cell.formula = listing.Image;
			cell.padding = {"top":10, "bottom":10, "left":10, "right":10};
		}
		if (i !== 0) {
			cell.value = listing[sheet.headerValues[i]];
			cell.fontsize = 12;
			cell.horizontalAlignment = 'CENTER';
			cell.verticalAlignment = 'MIDDLE';
		} 

		if (i === 1) {
			cell.value = '';
			cell.formula = listing.Name;
		}

		cell.wrapStrategy = 'WRAP';
	}
	await sheet.saveUpdatedCells();
}


// ------ Bus Routes ------
// for each row, get the coordinates from cells  L:Row and M:Row.
// make a request to the transit API to get nearby bus routes
// Make a string of the bus routes and put it in cell G:Row

// ------ Populate Bus Routes ------
// for each row, get the coordinates from cells  L:Row and M:Row.
// make a request to the transit API to get nearby bus routes

async function populateBusRoutes() {
	await doc.loadInfo();
	const sheet = doc.sheetsByIndex[0];

	// get the number of the last row in the sheet
	// (for some reason we have to use the sheet.getRows() method). sheet.rowCount is the whole sheet, not just the data
	const rows = await sheet.getRows();
	const numRows = rows.length + 1;

	// for each row, get the coordinates from cells  L:Row and M:Row.
	await sheet.loadCells("A1:P" + (numRows+1000)) // load the cells in the range")
	for (let i = 2; i < numRows+1; i++) {
		const lon_cell = sheet.getCellByA1("L" + i);
		const lat_cell = sheet.getCellByA1("M" + i);
		const lon = lon_cell.value;
		const lat = lat_cell.value;
		console.log("requesting bus routes for " + lon + " " + lat);
		getNearbyBusRoutes(lon, lat, populateBusCell, i);
	}
}

async function populateBusCell(bus_routes, rownum) {
	await doc.loadInfo();
	const sheet = doc.sheetsByIndex[0];
	await sheet.loadCells("A1:P" + (rownum+1000)) // load the cells in the range
	console.log("bus routes: " + bus_routes);
	const bus_routes_cell = sheet.getCellByA1("G" + rownum);
	bus_routes_cell.value = bus_routes;
	bus_routes_cell.wrapStrategy = 'WRAP';
	bus_routes_cell.fontsize = 12;
	bus_routes_cell.horizontalAlignment = 'CENTER';
	bus_routes_cell.verticalAlignment = 'MIDDLE';
	await sheet.saveUpdatedCells();
}




async function getNearbyBusRoutes(lon, lat, callback, rownum) {
	const api_key = Process.env.TRANSILINK_API;
	const url = "http://api.translink.ca/RTTIAPI/V1/stops?apikey=" + api_key + "&lat=" + lat + "&long=" + lon + "&radius=750";
	
	axios.get(url).then(function(response) {
		console.log(response + " for " + lon + " " + lat);
		const stops = response.data;
		var bus_routes = "";

		for (let i = 0; i < stops.length; i++) {
			const routes = stops[i].Routes.split(",");
			for (let j = 0; j < routes.length; j++) {

				// just a little bit of cleanup to make the bus routes look nicer
				if (routes[j][0] === " ") {
					routes[j] = routes[j].substring(1);
				}
				if (routes[j][0] === "0") {
					routes[j] = routes[j].substring(1);
				}
				if (!bus_routes.includes(routes[j])) {
					bus_routes += routes[j] + ", ";
				}
			}	
		}
		bus_routes = bus_routes.substring(0, bus_routes.length-2);
		callback(bus_routes, rownum);
		return;
	}).catch(function(error) {
		console.log("axios get error bus routes" + error + " for " + lon + " " + lat);
		callback("", rownum);
		return;
	});
}

// populateBusRoutes();