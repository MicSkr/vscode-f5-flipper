
import {
    ExtensionContext,
    commands,
    window,
    Uri,
    workspace,
    TextDocument
} from 'vscode';
import { NsCfgProvider } from './nsCfgViewProvider';
import { ext, initSettings, loadSettings } from './extensionVariables';
import fs from 'fs';
import * as os from 'os';
import { logger } from './logger';
import { Telemetry } from './telemetry';
import jsyaml from 'js-yaml';
import path from 'path';
import { NsDiag } from './nsDiag';
import { Hovers } from './hovers';

// turn off console logging
logger.console = false;

// create OUTPUT channel
const f5FlipperOutputChannel = window.createOutputChannel('f5-flipper');

// inject vscode output into logger
logger.output = function (log: string) {
    f5FlipperOutputChannel.appendLine(log);
};

export async function activateInternal(context: ExtensionContext) {


    logger.info(`Extension/Host details: `, {
        name: context.extension.packageJSON.name,
        displayName: context.extension.packageJSON.displayName,
        publisher: context.extension.packageJSON.publisher,
        description: context.extension.packageJSON.description,
        version: context.extension.packageJSON.version,
        license: context.extension.packageJSON.license,
        repository: context.extension.packageJSON.repository.url,
        host: JSON.stringify({
            hostOS: os.type(),
            platform: os.platform(),
            release: os.release()
        }),
        userInfo: JSON.stringify(os.userInfo())
    });

    // initialize extension settings
    await initSettings(context);

    // load ext config to ext.settings.
    await loadSettings();

    // create the telemetry service
	ext.telemetry = new Telemetry(context);
	// initialize telemetry service
	await ext.telemetry.init();

    process.on('unhandledRejection', error => {
        logger.error('--- unhandledRejection ---', error);
        ext.telemetry.capture({ unhandledRejection: JSON.stringify(error) });
    });
    
    new Hovers(context, ext.eventEmitterGlobal);

    ext.nsDiag = new NsDiag(context);  // move to settings/vars
    
    ext.nsCfgProvider = new NsCfgProvider();
    // const cfgView = window.registerTreeDataProvider('cfgTree', cfgProvider);
    const cfgView = window.createTreeView('nsConfigView', {
        treeDataProvider: ext.nsCfgProvider,
        showCollapseAll: true,
        canSelectMany: true
    });



    /**
     * this command is exposed via right click in editor so user does not have to connect to F5
     * this flow assumes the file is local
     */
    context.subscriptions.push(commands.registerCommand('f5-flipper.cfgExplore', async (item) => {

        let filePath: string;

        ext.telemetry.capture({ command: 'f5-flipper.cfgExplore' });

        f5FlipperOutputChannel.show();

        if (!item) {
            // no input means we need to browse for a local file
            item = await window.showOpenDialog({
                canSelectMany: false,
                defaultUri: Uri.file('/home/ted/project-flipper/example_configs/ns1_v13.1.conf')
            });

            // if we got a file from the showOpenDialog, it comes in an array, even though we told it to only allow single item selection -> return the single array item
            if (Array.isArray(item)) {
                item = item[0];
            }
        }

        if (item?._fsPath) {

            logger.info(`f5-flipper.cfgExplore _fsPath recieved:`, item._fsPath);
            filePath = item._fsPath;

        } else if (item?.path) {

            logger.info(`f5-flipper.cfgExplore path revieved:`, item.path);
            filePath = item.path;

        } else {

            return logger.error('f5-flipper.cfgExplore -> Neither path supplied was valid', JSON.stringify(item));

        }

        try {
            // test that we can access the file
            const x = fs.statSync(filePath);
        } catch (e) {
            // if we couldn't get to the file, trim leading character
            // remove leading slash -> i think this is a bug like:  https://github.com/microsoft/vscode-remote-release/issues/1583
            // filePath = filePath.replace(/^(\\|\/)/, '');
            logger.info(`could not find file with supplied path of ${filePath}, triming leading character`);
            filePath = filePath.substr(1);
        }

        logger.info(`f5-flipper.cfgExplore: exploding config @ ${filePath}`);

        ext.nsCfgProvider.makeExplosion(filePath);

        await new Promise(resolve => { setTimeout(resolve, 2000); });
        commands.executeCommand('nsConfigView.focus');

    }));

    
    context.subscriptions.push(commands.registerCommand('f5-flipper.cfgExploreTest', async (text) => {
        const testPath = path.join(context.extensionPath, 'example_configs', 't1.ns.conf')
        commands.executeCommand('f5-flipper.cfgExplore', Uri.file(testPath))
    }));


    context.subscriptions.push(commands.registerCommand('f5-flipper.cfgExploreClear', async (text) => {
        ext.telemetry.capture({ command: 'f5-flipper.cfgExploreClear' });
        ext.nsCfgProvider.clear();
        ext.nsCfgProvider.nsDiag = true;
    }));

    context.subscriptions.push(commands.registerCommand('f5-flipper.cfgExploreRefresh', async (text) => {
        ext.nsCfgProvider.refresh();
    }));

    context.subscriptions.push(commands.registerCommand('f5-flipper.cfgExplore-nsDiagSwitch', async (text) => {
        
        
        // flip switch and refresh details
        if(ext.nsCfgProvider.nsDiag){
            ext.nsCfgProvider.nsDiag = false;
            // ext.nsDiag.enabled = false;
            console.log('ns diag updatediagnostics disable');
            logger.info('disabling diagnostics')
            if(ext.nsDiag.lastDoc) {
                // clear the last editor diags
                ext.nsDiag.updateDiagnostic(ext.nsDiag.lastDoc);
            }
        } else {
            ext.nsCfgProvider.nsDiag = true;
            logger.info('enabling diagnostics')
            
            // was having errors about functions undefined, so, make sure everything is loaded as we turn this on
            // if (ext.nsDiag.updateDiagnostic === undefined) {
                console.log('ns diag updatediagnostics enable');
                // ext.nsDiag.enabled = true;
            // }
        }
        ext.nsCfgProvider.refresh();
    }));

    
    context.subscriptions.push(commands.registerCommand('f5-flipper.render', async (text) => {
        const x = cfgView?.selection;
        let full: string[] = [];
        // let text2;
        if (Array.isArray(x) && x.length > 1) {
            // got multi-select array, push all necessary details to a single object

            x.forEach((el) => {
                const y = el.command?.arguments;
                if (y) {
                    full.push(y[0].join('\n'));
                    full.push('\n\n#############################################\n\n');
                }
            });
            text = full;

            // } else if (Array.isArray(x) && x.length === 1) {
            // 	return window.showWarningMessage('Select multiple apps with "Control" key');
        } else if (typeof text === 'string') {
            // just text, convert to single array with render
            text = [text];
        }

        // todo: add logic to catch single right click

        let diagTag = false;
        const y = x[0];
        if (x[0]?.contextValue === 'cfgPartition' || x[0]?.contextValue === 'cfgAppItem') {
            diagTag = true;
        }

        // provide the text and "IF" xc diagnostics "CAN" be applied
        ext.nsCfgProvider.render(text, diagTag);
    }));


    context.subscriptions.push(commands.registerCommand('f5-flipper.report', async (text) => {
        ext.telemetry.capture({ command: 'f5-flipper.report' });

        const brkr = '\n\n--- ##################################################\n\n'

        // build a welcome banner
        const welcome = [
            'Citrix ADC/NS -> F5 Application report.',
            '',
            'Please visit the following repo for any questions, issues or enhancements',
            '',
            'https://github.com/DumpySquare/project-flipper',
            brkr
        ]


        // build report header
        const reportHeader = {
            hostname: ext.nsCfgProvider.explosion.hostname,
            id: ext.nsCfgProvider.explosion.id,
            inputFileType: ext.nsCfgProvider.explosion.inputFileType,
            dateTime: ext.nsCfgProvider.explosion.dateTime,
            stats: ext.nsCfgProvider.explosion.stats,
            sources: ext.nsCfgProvider.explosion.config.sources.map(el => {
                return { fileName: el.fileName, size: el.size }
            })
        }

        // build apps
        const reportApps = []
        for (const app of ext.nsCfgProvider.explosion.config.apps) {
            const appCopy = JSON.parse(JSON.stringify(app))
            delete appCopy.lines;
            reportApps.push(
                brkr,
                jsyaml.dump(appCopy, { indent: 4 }),
                '',
                '--- Original Application config lines',
                ...app.lines, '', '')
        }

        // put all the content together
        const content = [
            welcome.join('\n'),
            jsyaml.dump(reportHeader, { indent: 4, lineWidth: -1 }),
            reportApps.join('\n')
        ].join('')

        var vDoc: Uri = Uri.parse("untitled:" + 'CitrixADC_Report.txt');
        return await workspace.openTextDocument({ language: 'yaml', content })
        .then( async (doc) => {
            await window.showTextDocument(doc);
            // this.documents.push(doc);  // add the document to this class doc list
            return doc;
        });
    }));

    // context.subscriptions.push(disposable);
}



// this method is called when your extension is deactivated
export async function deactivateInternal(context: ExtensionContext) {
    // log deactivation event
}