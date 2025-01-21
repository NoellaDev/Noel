import { supported_providers, required_keys, provider_aliases } from "../models/hardcoded_stuff";
import { useActiveKeys } from "../api_keys/ActiveKeysContext";
import { ProviderSetupModal } from "../modals/ProviderSetupModal";
import React from "react";
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from "@radix-ui/react-accordion";
import {Check, ChevronDown, Edit2, Plus, X} from "lucide-react";
import {Button} from "../../ui/button";
import {getApiUrl, getSecretKey} from "../../../config";
import {getActiveProviders} from "../api_keys/utils";

// Utility Functions
function getProviderDescription(provider) {
    const descriptions = {
        "OpenAI": "Access GPT-4, GPT-3.5 Turbo, and other OpenAI models",
        "Anthropic": "Access Claude and other Anthropic models",
        "Google": "Access Gemini and other Google AI models",
        "Groq": "Access Mixtral and other Groq-hosted models",
        "Databricks": "Access models hosted on your Databricks instance",
        "OpenRouter": "Access a variety of AI models through OpenRouter",
        "Ollama": "Run and use open-source models locally",
    };
    return descriptions[provider] || `Access ${provider} models`;
}

function useProviders(activeKeys) {
    return React.useMemo(() => {
        return supported_providers.map((providerName) => {
            const alias = provider_aliases.find((p) => p.provider === providerName)?.alias || providerName.toLowerCase();
            const requiredKeys = required_keys[providerName] || [];
            const isConfigured = activeKeys.includes(providerName);

            return {
                id: alias,
                name: providerName,
                keyName: requiredKeys,
                isConfigured,
                description: getProviderDescription(providerName),
            };
        });
    }, [activeKeys]);
}

// Reusable Components
function ProviderStatus({ isConfigured }) {
    return isConfigured ? (
        <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-500">
            <Check className="h-4 w-4" />
            <span>Configured</span>
        </div>
    ) : (
        <div className="flex items-center gap-1 text-sm text-red-600 dark:text-red-500">
            <X className="h-4 w-4" />
            <span>Not Configured</span>
        </div>
    );
}

function ProviderKeyList({ keyNames, activeKeys }) {
    return keyNames.length > 0 ? (
        <div className="text-sm space-y-2">
            <span className="text-gray-500 dark:text-gray-400">Required API Keys:</span>
            {keyNames.map((key) => (
                <div key={key} className="flex items-center gap-2">
                    <code className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{key}</code>
                    {activeKeys.includes(key) && <Check className="h-4 w-4 text-green-500" />}
                </div>
            ))}
        </div>
    ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400">No API keys required</div>
    );
}

function ProviderActions({ provider, onEdit, onDelete, onAdd }) {
    return provider.isConfigured ? (
        <div className="flex items-center gap-3">
            <Button
                variant="outline"
                size="default"
                onClick={() => onEdit(provider)}
                className="text-gray-700 dark:text-gray-300"
            >
                <Edit2 className="h-4 w-4 mr-2" />
                Edit Keys
            </Button>
            <Button
                variant="outline"
                size="default"
                onClick={() => onDelete(provider)}
                className="text-red-600 hover:text-red-700 dark:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
            >
                Delete Keys
            </Button>
        </div>
    ) : (
        <Button
            variant="default"
            size="default"
            onClick={() => onAdd(provider)}
            className="text-indigo-50 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700 w-fit"
        >
            <Plus className="h-4 w-4 mr-2" />
            Add Keys
        </Button>
    );
}

function ProviderItem({ provider, activeKeys, onEdit, onDelete, onAdd }) {
    return (
        <AccordionItem
            key={provider.id}
            value={provider.id}
            className="border rounded-lg px-6 bg-white dark:bg-gray-800 shadow-sm"
        >
            <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-4">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{provider.name}</div>
                        <ProviderStatus isConfigured={provider.isConfigured} />
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400 transition-transform duration-200" />
                </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-6">
                <div className="space-y-6">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{provider.description}</p>
                    <div className="flex flex-col space-y-4">
                        <ProviderKeyList keyNames={provider.keyName} activeKeys={activeKeys} />
                        <ProviderActions provider={provider} onEdit={onEdit} onDelete={onDelete} onAdd={onAdd} />
                    </div>
                </div>
            </AccordionContent>
        </AccordionItem>
    );
}

// Main Component
export function Providers() {
    const { activeKeys, setActiveKeys } = useActiveKeys();
    const providers = useProviders(activeKeys);
    const [selectedProvider, setSelectedProvider] = React.useState(null);
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    const handleEdit = (provider) => {
        setSelectedProvider(provider);
        setIsModalOpen(true);
    };

    const handleModalSubmit = async (apiKey) => {
        if (!selectedProvider) return;

        const provider = selectedProvider.name;
        const keyName = required_keys[provider]?.[0]; // Get the first key, assuming one key per provider

        if (!keyName) {
            console.error(`No key found for provider ${provider}`);
            return;
        }

        try {
            // Log to debug the payload
            console.log("Attempting to delete key:", keyName);

            // Delete old key logic
            const deleteResponse = await fetch(getApiUrl("/secrets/delete"), {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "X-Secret-Key": getSecretKey(),
                },
                body: JSON.stringify({ key: keyName }), // Send the key as expected by the Rust endpoint
            });

            if (!deleteResponse.ok) {
                const errorText = await deleteResponse.text();
                console.error("Delete response error:", errorText);
                throw new Error("Failed to delete old key");
            }

            console.log("Key deleted successfully.");

            // Store new key logic
            const storeResponse = await fetch(getApiUrl("/secrets/store"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Secret-Key": getSecretKey(),
                },
                body: JSON.stringify({
                    key: keyName,
                    value: apiKey.trim(),
                }),
            });

            if (!storeResponse.ok) {
                const errorText = await storeResponse.text();
                console.error("Store response error:", errorText);
                throw new Error("Failed to store new key");
            }

            console.log("Key stored successfully.");

            // Update active keys
            const updatedKeys = await getActiveProviders();
            setActiveKeys(updatedKeys);

            setIsModalOpen(false);
        } catch (error) {
            console.error("Error handling modal submit:", error);
        }
    };

    return (
        <div className="space-y-6">
            <div className="text-gray-500 dark:text-gray-400 mb-6">
                Configure your AI model providers by adding their API keys. Your keys are stored securely and encrypted locally.
            </div>

            <Accordion type="single" collapsible className="w-full space-y-4">
                {providers.map((provider) => (
                    <ProviderItem
                        key={provider.id}
                        provider={provider}
                        activeKeys={activeKeys}
                        onEdit={handleEdit}
                        onDelete={() => console.log("Delete", provider)}
                        onAdd={() => console.log("Add", provider)}
                    />
                ))}
            </Accordion>

            {isModalOpen && selectedProvider && (
                <ProviderSetupModal
                    provider={selectedProvider.name}
                    model="Example Model"
                    endpoint="Example Endpoint"
                    onSubmit={handleModalSubmit}
                    onCancel={() => setIsModalOpen(false)}
                />
            )}
        </div>
    );
}
