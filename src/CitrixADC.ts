

'use strict';

import { EventEmitter } from 'events';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { digCsVservers } from './digCsVserver';
import { digLbVserver } from './digLbVserver';
import { digGslbVservers } from './digGslbVserver';

// import { RegExTree, TmosRegExTree } from './regex'
import intLogger from './intLogger';
import { logger } from './logger';
import { AdcApp, AdcConfObj, AdcRegExTree, ConfigFile, Explosion, Stats } from './models'
import { countMainObjects } from './objectCounter';
import { parseAdcConf } from './parseAdc';
import { parseAdcConfArrays } from './parseAdcArrys';
import { RegExTree } from './regex';
// import { countObjects } from './objCounter';
// import { ConfigFile } from './models';
// import { digVsConfig, getHostname } from './digConfigs';
import { UnPacker } from './unPackerStream';




/**
 * Class to consume Citrix ADC archive/configs -> parse apps
 * 
 */
export default class ADC extends EventEmitter {
    /**
     * incoming config files array
     * ex. [{filename:'ns.conf',size:12345,content:'...'},{...}]
     */
    public configFiles: ConfigFile[] = [];
    /**
     * tmos config as nested json objects 
     * - consolidated parant object keys like add cs vserver/add lb vserver/add gslb vserver
     */
    // public configObject: AdcConfObj = {};
    public configObjectArry: AdcConfObj = {};
    /**
     * adc version
     */
    public adcVersion: string | undefined;
    /**
     * adc build number
     */
    public adcBuild: string | undefined;
    /**
     * hostname of the source device
     */
    public hostname: string | undefined;
    /**
     * input file type (.conf/.tgz)
     */
    public inputFileType: string;
    /**
     * ADC version specific regex tree for abstracting applications
     */
    public rx: AdcRegExTree | undefined;
    /**
     * ns processing stats object
     */
    private stats: Stats = {
        objectCount: 0,
    };
    /**
     * ADC/NS license file
     */
    license: ConfigFile;
    /**
     * adc file store files, which include certs/keys/external_monitors/...
     */
    fileStore: ConfigFile[] = [];

    constructor() {
        super();
    }

    /**
     * load and do initial parse of ns config file/archive
     * @param file ns.conf or ns.tgz
     */
    async loadParseAsync(file: string): Promise<void> {
        const startTime = process.hrtime.bigint();
        // capture incoming file type
        this.inputFileType = path.parse(file).ext;

        const parseConfPromises: any[] = [];
        const parseStatPromises: any[] = [];
        const unPacker = new UnPacker();

        unPacker.on('conf', conf => {
            // parse .conf files, capture promises
            parseConfPromises.push(this.parseConf(conf))
        })

        await unPacker.stream(file)
            .then(async ({ files, size }) => {

                this.stats.sourceSize = size;

                // wait for all the parse config promises to finish
                await Promise.all(parseConfPromises)

            })

        // wait for all the stats files processing promises to finish
        await Promise.all(parseStatPromises)

        // assign souceAdcVersion to stats object also
        this.stats.sourceAdcVersion = this.adcVersion

        // end processing time, convert microseconds to miliseconds
        this.stats.parseTime = Number(process.hrtime.bigint() - startTime) / 1000000;

        return;
    }


    /**
     * async parsing of config files
     */
    async parseConf(conf: ConfigFile): Promise<void> {

        // emit event about the config file we are about to parse
        this.emit('parseFile', conf.fileName)

        // standardize line endings -> not the best way, but it works
        conf.content = conf.content.replace(/\r\n/g, '\n')

        // split the config into lines
        const config = conf.content.split('\n')

        // count lines of config, add to stats
        // get object counts (lines)
        this.stats.lineCount = config.length;
        this.stats.objectCount = config.length;

        // push the raw config files to storage array
        this.configFiles.push(conf)

        if (this.rx) {
            // have an RX tree already so asyncronously test the file version matches
            this.setAdcVersion(conf)
        } else {
            // no RX tree set yet, so wait for this to finish
            await this.setAdcVersion(conf)
        }

        // array of unused/unparsed objects
        const orphans: string[] = [];

        // this.configObject = await parseAdcConf(config, this.rx!);
        this.configObjectArry = await parseAdcConfArrays(config, this.rx!);

        // get hostname from configObjectArry, assign to parent class for easy access
        if (this.configObjectArry.set.ns.hostName.length > 0) {
            // there should always be only one in this array
            this.hostname = this.configObjectArry.set.ns.hostName[0];
        }

        // gather stats on the number of different objects found (vservers/monitors/policies)
        await countMainObjects(this.configObjectArry)
            .then(stats => {
                this.stats.objects = stats;
            });
    }



    /**
     * parses config file for tmos version, sets tmos version specific regex tree used to parse applications
     * @param x config-file object
     */
    async setAdcVersion(x: ConfigFile): Promise<void> {
        if (this.rx) {
            // rex tree already assigned, lets confirm subsequent file tmos version match
            if (this.adcVersion === this.getAdcVersion(x.content, this.rx.adcVersion)[0]) {
                // do nothing, current file version matches existing files tmos verion
            } else {
                const err = `Parsing [${x.fileName}], adc version of this file does not match previous file [${this.adcVersion}]`;
                intLogger.error(err)
                // throw new Error(err);
            }
        } else {

            // first time through - build everything
            const rex = new RegExTree();  // instantiate regex tree
            [this.adcVersion, this.adcBuild] = this.getAdcVersion(x.content, rex.adcVersionBaseReg);  // get adc version
            intLogger.info(`Recieved .conf file of version: ${this.adcVersion}`)

            // assign regex tree for particular version
            this.rx = rex.get(this.adcVersion)
        }
    }






    /**
     * returns all details from processing
     * 
     * - 
     */
    async explode(): Promise<Explosion> {

        // if config has not been parsed yet...
        // if (!this.configObject.ltm?.virtual) {
        //     await this.parse(); // parse config files
        // }

        const apps = await this.apps();   // extract apps before pack timer...

        const startTime = process.hrtime.bigint();  // start pack timer

        // // extract DO classes (base information expanded)
        // const doClasses = await digDoConfig(this.configObject);

        // build return object
        const retObj = {
            id: uuidv4(),                           // generat uuid,
            dateTime: new Date(),                   // generate date/time
            hostname: this.hostname,
            inputFileType: this.inputFileType,      // add input file type
            config: {
                sources: this.configFiles,
            },
            stats: this.stats,                      // add stats object
            logs: await this.logs()                 // get all the processing logs
        }

        if (apps.length > 0) {
            // add virtual servers (apps), if found
            retObj.config['apps'] = apps;
        }

        if (this.fileStore.length > 0) {
            // add files from file store
            retObj['fileStore'] = this.fileStore;
        }

        // capture pack time
        this.stats.packTime = Number(process.hrtime.bigint() - startTime) / 1000000;

        return retObj
    }

    /**
     * Get processing logs
     */
    async logs(): Promise<string[]> {
        return intLogger.getLogs();
    }


    /**
     * extracts app(s)
     * @param app single app string
     * @return [{ name: <appName>, config: <appConfig>, map: <appMap> }]
     */
    async apps() {

        // setup our array to hold the apps
        const apps: AdcApp[] = []

        // start our timer for abstracting apps
        const startTime = process.hrtime.bigint();


        // dig each 'add cs vserver'
        await digCsVservers(this.configObjectArry, this.rx)
            .then(csApps => apps.push(...csApps as AdcApp[]))

        // dig each 'add lb vserver', but check for existing?
        await digLbVserver(this.configObjectArry, this.rx)
            .then(lbApps => apps.push(...lbApps as AdcApp[]))


        await digGslbVservers(this.configObjectArry, this.rx)
            .then(gslbApps => apps.push(...gslbApps));


        // capture app abstraction time
        this.stats.appTime = Number(process.hrtime.bigint() - startTime) / 1000000;

        // log a warning if we didn't abstract any apps
        if (apps.length === 0) {
            logger.warn('no "add cs vserver"/"add lb vserver"/"add gslb vserver" objects found - excluding apps information')
        }

        // return the app array
        return apps;
    }



    /**
     * extract tmos config version from first line
     * ex.  #TMSH-VERSION: 15.1.0.4
     * @param config bigip.conf config file as string
     */
    private getAdcVersion(config: string, regex: RegExp): [string, string] {
        const version = config.match(regex);
        if (version) {
            //found adc version, grab build (split off first line, then split build by spaces)
            const build = config.split('\n')[0].split(' ')[2]
            // return details
            return [version[1], build];
        } else {
            const msg = 'citrix adc/ns version not detected -> meaning this probably is not an ns.conf'
            intLogger.error(msg)
            throw new Error(msg)
        }
    }

}


/**
 * sorts AdcApp object properties
 *  mainly makes sure name/type/ipAddress/port are at the top and lines are at the bottom
 * @param app 
 * @returns 
 */
export function sortAdcApp(app: AdcApp): AdcApp {

    const sorted: AdcApp = {
        name: app.name,
        type: app.type,
        protocol: app.protocol,
        ipAddress: app.ipAddress,
        port: app.port,
        opts: app.opts || undefined,
        bindings: app.bindings,
        csPolicies: app.csPolicies,
        lines: app.lines,
        apps: app.apps
    }
    return sorted;
}

// /**
//  * standardize line endings to linux
//  * "\r\n" and "\r" to "\n"
//  * @param config config as string
//  * @returns config
//  */
// function standardizeLineReturns (config: string){
//     const regex = /(\r\n|\r)/g;
//     return config.replace(regex, "\n");
// }

// /**
//  * Reverse string
//  * @param str string to reverse
//  */
// function reverse(str: string){
//     return [...str].reverse().join('');
//   }


