import schema from "./schema.json" with { type: "json" };
export { schema };

/**
 * @typedef {Object} Endpoint
 * @property {string} iata
 * @property {string} name
 * @property {string} city
 * @property {string} [terminal]
 * @property {string} [gate]
 * @property {string} [gateOpen]
 * @property {string} [boarding]
 * @property {string} [depart]
 * @property {string} [arrive]
 */

/**
 * @typedef {Object} FormState
 * @property {{passTypeId:string, teamId:string, organizationName:string, serialNumber:string, description:string}} meta
 * @property {{logoText:string, foregroundColor:string, backgroundColor:string, labelColor:string}} branding
 * @property {{airlineCode:string, flightNumber:string, departure:Endpoint, arrival:Endpoint}} flight
 * @property {{name:string, frequentFlyerNumber?:string, seats:Array<{number:string,cabin:string,row?:string,letter?:string}>, boardingGroup:string, seqNumber:string}} passenger
 * @property {{format:string, message:string, altText:string}} barcode
 * @property {Object} [iOS26]
 */
