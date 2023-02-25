

import logger from "./logger";
import { AdcRegExTree } from "./models";

// /**
//  * This file servers as the central place for all regex's, we'll call it a regex tree
//  * 
//  * The idea here is to create a base regex object tree, based on v14/v15 code
//  *  if/when any changes in config structure that require tweaks to the regex tree
//  *  only those changes will need to be configured in a tree for each respective 
//  *  configuration deviatione (ex v16), then merged with the default/base regex tree
//  *  
//  * Need to find a better way to do regex's across the package.  The regular "match",
//  *  on string function works, but also returns the entire full match in [0], then
//  *  capture groups as nested array on [1].  
//  *  - I know there is plenty of improvements to be made by only returning the match capture group [1]
//  *  - and defining better capture groups (probably include lookarounds)
//  * 
//  * Need to also look into if .matchAll will help.  Seems to be available in NodeJS, 
//  *  only in ECMA2020 TypeScript
//  */

/**
 * Regex Tree used for searching configs
 */
export class RegExTree {

    /**
     * extracts citrix adc version at beginning of ns.conf
     * #NS13.1 Build 37.38
     */
    public adcVersionBaseReg = /#NS([\d\.]+) /;
    // potenatilly remove
    public adcVersionBuildReg = /#NS(\d.+)/;
    /**
     * get hostname
     * ex. 'set ns hostName ctxslab.local'
     */
    public adcHostname = /set ns hostName (\S+)/;

    /**
     * captures ns config options that begin with "-"
     * example;  "set ns config -IPAddress 192.168.86.140 -netmask 255.255.255.0"
     * captures ['-IPAddress 192.168.86.140', '-netmask 255.255.255.0']
     */
    public cfgOptions = /-\w+ \S+/g;
    public cfgOptionsQuotes = /-\w+ "[\S ]+"/g;

    private ipAddr = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/;

    /**
     * base regex tree for extracting citrix ns adc config items
     */
    private regexTree: AdcRegExTree = {
        adcVersion: this.adcVersionBaseReg,
        adcBuild: this.adcVersionBuildReg,
        cfgOptions: this.cfgOptions,
        cfgOptionsQuotes: this.cfgOptionsQuotes,
        verbs: /^(add|set|bind|link|enable|disable) /,
        'add ns ip': /add ns ip (?<name>\S+) (?<mask>\S+) (?<opts>[\S ]+)/,
        'add ns ip6': /add ns ip6 (?<name>\S+) (?<opts>[\S ]+)/,
        'add ns rpcNode': /add ns rpcNode (?<name>\S+) (?<opts>[\S ]+)/,
        'add route': /add server (?<opts>\S+)/,
        'add dns nameServer': /add lb nameServer (?<server>\S+)/,
        'add lb vserver': /add lb vserver (?<name>\S+) (?<type>\S+) (?<ipAddress>[\d.]+) (?<port>\d+) (?<opts>[\S ]+)/,
        'add lb monitor': /add lb monitor (?<name>\S+) (?<type>\S+) (?<opts>[\S ]+)/,
        'add ssl certKey': /add ssl certKey (?<name>\S+) (?<opts>[\S ]+)/,
        'add server': /add server (?<name>\S+) (?<value>\S+)/,
        'add service': /add service (?<name>\S+) (?<value>\S+)/,
        'add serviceGroup': /add serviceGroup (?<name>\S+) (?<value>\S+)/,
        'add cs vserver': /add cs vserver (?<name>\S+) (?<opts>\S+)/,
        'add cs action': /add cs action (?<name>\S+) (?<opts>\S+)/,
        'add cs policy': /add cs policy (?<name>\S+) (?<opts>\S+)/,
        'add rewrite action': /add rewrite action (?<name>\S+) (?<opts>\S+)/,
        'add rewrite policy': /add rewrite policy (?<name>\S+) (?<opts>\S+)/,
        'set ssl vserver': /set ssl vserver (?<name>\S+) (?<opts>[\S ]+)/,
        'set lb monitor': /set lb monitor (?<name>\S+) (?<opts>[\S ]+)/,
        'set ns param': /set ns param (?<opts>[\S ]+)/,
        'bind service': /bind service (?<opts>[\S ]+)/,
        'bind serviceGroup': /bind serviceGroup (?<opts>[\S ]+)/,
        'bind lb vserver': /bind lb vserver (?<opts>[\S ]+)/,
        'bind cs vserver': /bind cs vserver (?<opts>[\S ]+)/,
        'bind ssl vserver': /bind ssl vserver (?<opts>[\S ]+)/,
    }

    constructor() {
        // commend to keep TS error away...
    }

    /**
     * Return updated base regex tree depending on version config differences
     * 
     * @param adcVersion
     */
    get(adcVersion: string): AdcRegExTree {
        const x = removeVersionDecimals(adcVersion);

        /**
         * the following is just examples of how to expand the regex tree for different versions :)
         *  this should change a little as this matures and the regex madness gets cleaned up
         */

        // full tmos version without decimals
        if(x > 19000) {
            logger.error('>v19.0.0.0 tmos detected - this should never happen!!!')
            // this.regexTree.vs.fbPersist = /new-fallBackPersist-regex/;
            // this.regexTree.vs.pool.obj = /new-pool-regex/;
        }
        if(x < 12000){
            logger.error('<v12.0.0.0 tmos detected - have not tested this yet!!!')
            // other regex tree changes specific to v12.0.0.0
        }
        return this.regexTree;
    }


}



/**
 * combines multi-line commented regex final regex
 * @param regs regex pieces in array
 * @param opts regex options (g/m/s/i/y/u/s)
 */
export function multilineRegExp(regs: RegExp[], opts: string): RegExp {
    return new RegExp(regs.map(reg => reg.source).join(''), opts);
}



export type TmosRegExTree = {
    tmosVersion: RegExp,
    parentObjects: RegExp,
    parentNameValue: RegExp,
    vs: {
        pool: {
            obj: RegExp,
            members: RegExp,
            nodesFromMembers: RegExp,
            monitors: RegExp
        },
        profiles: {
            obj: RegExp,
            names: RegExp
        },
        rules: {
            obj: RegExp,
            names: RegExp
        },
        snat: {
            obj: RegExp,
            name: RegExp
        },
        ltPolicies: {
            obj: RegExp,
            names: RegExp
        },
        persist: {
            obj: RegExp,
            name: RegExp
        },
        fbPersist: RegExp,
        destination: RegExp
    }
}

/**
 * returns full number without decimals so it can be compared
 * @param ver tmos version in full x.x.x.x format
 */
function removeVersionDecimals(ver: string): number {
    return parseInt(ver.replace(/\./g, ''));
}

// const regexTree = new RegExTree();
// export default regexTree;